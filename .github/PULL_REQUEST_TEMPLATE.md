## Summary
<!-- What changed? Keep it concrete. -->

## Why
<!-- Why is this needed? Include root cause for fixes. -->

## Affected Areas
<!-- Check all that apply. -->
- [ ] Admin UI / components
- [ ] Customer auth / database-admin membership
- [ ] Public API routes
- [ ] Market API access / usage / billing / anonymous limiting
- [ ] Database / Drizzle / migrations
- [ ] Uploads / storage providers
- [ ] API-key or provider integration
- [ ] Email / external integrations
- [ ] Config / env / deployment
- [ ] Docs / repository metadata
- [ ] Other:

## Validation
<!-- Exact commands run and results. Include known warnings/failures. -->
```bash
bun install --frozen-lockfile
bun run db:build
bun run type-check
bun run lint
bun run test
```

## Rollout Notes
<!-- Env vars, schema changes, provider behavior, risk, backout plan. -->

## Screenshots / Video
<!-- Required for visible UI changes. Use N/A otherwise. -->

## Checklist
- [ ] I reviewed my own diff
- [ ] I documented the validation results that apply
- [ ] I called out env, schema, cache, provider, and rollout impact
- [ ] I did not manually edit generated files under `*/migrations/`
- [ ] I did not include secrets or private credentials
