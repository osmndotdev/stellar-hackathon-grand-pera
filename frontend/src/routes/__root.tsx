import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { WalletChip } from '@/components/WalletChip'
import { WalletProvider } from '@/hooks/useWallet'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <WalletProvider>
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4">
        <header className="flex h-16 items-center justify-between">
          <Link to="/" className="font-display flex items-center gap-1.5 text-[22px] font-extrabold">
            Plink
            <span className="mt-2 inline-block size-2.5 rounded-full bg-accent" aria-hidden />
          </Link>
          <WalletChip />
        </header>
        <main className="flex-1 pb-10">
          <Outlet />
        </main>
        <footer className="pb-6 pt-4 text-center text-[12px] text-muted">
          Runs on Stellar testnet. Bank transfers are simulated by the TR Mock Anchor.
        </footer>
      </div>
    </WalletProvider>
  )
}
