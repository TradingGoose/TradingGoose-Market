import { CurrenciesTable } from './components/currencies-table'

export default function CurrenciesPage() {
  return (
    <main className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <section className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        <CurrenciesTable />
      </section>
    </main>
  )
}
