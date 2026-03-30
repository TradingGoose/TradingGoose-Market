import { CryptosTable } from './components/cryptos-table'

export default function CryptosPage() {
  return (
    <main className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <section className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        <CryptosTable />
      </section>
    </main>
  )
}
