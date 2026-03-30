import { ChainsTable } from './components/chains-table'

export default function ChainsPage() {
  return (
    <main className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <section className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        <ChainsTable />
      </section>
    </main>
  )
}
