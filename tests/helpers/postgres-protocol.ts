import { createServer, type Socket } from "node:net";

export type PostgresFixtureColumn = {
  name: string;
  oid: number;
};

export type PostgresFixtureResult = {
  columns?: PostgresFixtureColumn[];
  rows?: Array<Array<string | null>>;
  command?: string;
  error?: string;
};

export type PostgresFixtureQuery = {
  connectionId: number;
  sql: string;
  parameters: Array<string | null>;
  phase: "describe" | "execute";
};

function int16(value: number) {
  const result = Buffer.alloc(2);
  result.writeInt16BE(value);
  return result;
}

function int32(value: number) {
  const result = Buffer.alloc(4);
  result.writeInt32BE(value);
  return result;
}

function cstring(value: string) {
  return Buffer.from(`${value}\0`);
}

function message(type: string, ...parts: Buffer[]) {
  const payload = Buffer.concat(parts);
  return Buffer.concat([Buffer.from(type), int32(payload.length + 4), payload]);
}

function rowDescription(columns: PostgresFixtureColumn[]) {
  return message("T", int16(columns.length), ...columns.map((column) =>
    Buffer.concat([
      cstring(column.name),
      int32(0),
      int16(0),
      int32(column.oid),
      int16(-1),
      int32(-1),
      int16(0),
    ]),
  ));
}

function dataRow(row: Array<string | null>) {
  return message("D", int16(row.length), ...row.map((value) => {
    if (value === null) return int32(-1);
    const data = Buffer.from(value);
    return Buffer.concat([int32(data.length), data]);
  }));
}

/** Minimal wire server: tests exercise the installed Postgres.js/Drizzle drivers. */
export async function createPostgresProtocolFixture(
  respond: (query: PostgresFixtureQuery) => PostgresFixtureResult | Promise<PostgresFixtureResult>,
) {
  let nextConnectionId = 0;
  const sockets = new Set<Socket>();
  const queries: PostgresFixtureQuery[] = [];
  const server = createServer((socket) => {
    socket.setNoDelay(true);
    sockets.add(socket);
    const connectionId = ++nextConnectionId;
    let buffered = Buffer.alloc(0);
    let started = false;
    let transactionStatus = "I";
    let statement = "";
    let parameters: Array<string | null> = [];
    let pendingMessages = Promise.resolve();

    const ready = () => socket.write(message("Z", Buffer.from(transactionStatus)));
    const execute = async (sql: string) => {
      const query: PostgresFixtureQuery = { connectionId, sql, parameters, phase: "execute" };
      queries.push(query);
      return respond(query);
    };
    const writeResult = (result: PostgresFixtureResult, describe: boolean) => {
      if (result.error) {
        transactionStatus = transactionStatus === "T" ? "E" : "I";
        socket.write(message("E", cstring("SERROR"), cstring("CXX000"), cstring(`M${result.error}`), Buffer.from([0])));
        return;
      }
      if (describe && result.columns) socket.write(rowDescription(result.columns));
      for (const row of result.rows ?? []) socket.write(dataRow(row));
      const command = result.command ?? (/^select\b/i.test(statement.trim()) ? `SELECT ${result.rows?.length ?? 0}` : statement.trim().split(" ")[0].toUpperCase());
      if (/^begin\b/i.test(statement)) transactionStatus = "T";
      if (/^(commit|rollback$)/i.test(statement)) transactionStatus = "I";
      socket.write(message("C", cstring(command)));
    };

    const handle = async (type: string, payload: Buffer) => {
      if (type === "X") return socket.end();
      if (type === "P") {
        const nameEnd = payload.indexOf(0);
        statement = payload.toString("utf8", nameEnd + 1, payload.indexOf(0, nameEnd + 1));
        socket.write(message("1"));
      } else if (type === "B") {
        let offset = payload.indexOf(0) + 1;
        offset = payload.indexOf(0, offset) + 1;
        const formatCount = payload.readInt16BE(offset);
        offset += 2 + formatCount * 2;
        const parameterCount = payload.readInt16BE(offset);
        offset += 2;
        parameters = [];
        for (let i = 0; i < parameterCount; i++) {
          const size = payload.readInt32BE(offset);
          offset += 4;
          parameters.push(size === -1 ? null : payload.toString("utf8", offset, offset + size));
          if (size > 0) offset += size;
        }
        socket.write(message("2"));
      } else if (type === "D") {
        const result = await respond({ connectionId, sql: statement, parameters: [], phase: "describe" });
        if (payload[0] === 83) {
          const parameterCount = Math.max(0, ...Array.from(statement.matchAll(/\$(\d+)/g), (match) => Number(match[1])));
          socket.write(message("t", int16(parameterCount), ...Array.from({ length: parameterCount }, () => int32(25))));
        }
        socket.write(result.columns ? rowDescription(result.columns) : message("n"));
      } else if (type === "E") {
        writeResult(await execute(statement), false);
      } else if (type === "S") {
        ready();
      } else if (type === "H") {
        // Flush has no response; writes above are immediate.
      } else if (type === "Q") {
        statement = payload.toString("utf8", 0, payload.length - 1);
        parameters = [];
        writeResult(await execute(statement), true);
        ready();
      }
    };

    socket.on("data", (data) => {
      buffered = Buffer.concat([buffered, Buffer.from(data)]);
      if (!started) {
        if (buffered.length < 4 || buffered.length < buffered.readInt32BE(0)) return;
        const length = buffered.readInt32BE(0);
        buffered = buffered.subarray(length);
        started = true;
        socket.write(Buffer.concat([
          message("R", int32(0)),
          message("K", int32(connectionId), int32(1234)),
          message("S", cstring("server_version"), cstring("16.0")),
          message("S", cstring("client_encoding"), cstring("UTF8")),
          message("Z", Buffer.from("I")),
        ]));
      }
      while (buffered.length >= 5 && buffered.length >= buffered.readInt32BE(1) + 1) {
        const length = buffered.readInt32BE(1);
        const type = String.fromCharCode(buffered[0]);
        const payload = buffered.subarray(5, length + 1);
        buffered = buffered.subarray(length + 1);
        pendingMessages = pendingMessages.then(() => handle(type, payload)).then(() => undefined);
      }
    });
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture port was not assigned");

  return {
    url: `postgresql://fixture:fixture@127.0.0.1:${address.port}/fixture`,
    queries,
    connectionCount: () => nextConnectionId,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
