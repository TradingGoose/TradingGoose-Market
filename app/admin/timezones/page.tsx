import { TimeZonesTable } from './components/timezones-table'

export default function TimezonesPage() {
  return (
    <main className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <section className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        <TimeZonesTable />
      </section>
    </main>
  )
}
