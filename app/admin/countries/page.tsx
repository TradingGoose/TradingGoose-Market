import { CountriesTable } from './components/countries-table'

export default function CountriesPage() {
  return (
    <main className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <section className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        <CountriesTable />
      </section>
    </main>
  )
}
