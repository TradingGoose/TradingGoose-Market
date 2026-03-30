import { CitiesTable } from './components/cities-table'

export default function CitiesPage() {
  return (
    <main className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <section className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        <CitiesTable />
      </section>
    </main>
  )
}
