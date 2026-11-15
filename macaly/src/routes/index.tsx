import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import siteMetadata from '../metadata.json'
import { ES_LOGO_DEFS } from '@/legacy/logo'

const homepageMeta = siteMetadata['/']

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: homepageMeta.title },
      { name: 'description', content: homepageMeta.description },
      { name: 'robots', content: 'noindex' },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@300;400;500;600;700&display=swap' },
      { rel: 'stylesheet', href: '/legacy/styles.css' },
    ],
  }),
  component: App,
})

// Aplikácia ES Prepočet beží len v prehliadači: obrazovky vykreslí do #root až po prihlásení (src/legacy/boot.ts).
function App() {
  useEffect(() => {
    import('@/legacy/boot').then((m) => m.boot(import.meta.env.VITE_CONVEX_URL as string)).catch((e) => {
      const el = document.getElementById('root')
      if (el) el.textContent = 'Aplikáciu sa nepodarilo spustiť: ' + (e?.message || e)
    })
  }, [])
  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ES_LOGO_DEFS }} />
      <div id="root">
        <div className="shell"><main className="main"><div className="page"><div className="empty"><div className="spinner" /><p>Načítavam…</p></div></div></main></div>
      </div>
    </>
  )
}
