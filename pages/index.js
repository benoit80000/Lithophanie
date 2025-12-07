import Head from 'next/head';
import LithophaneMaker from '../components/LithophaneMaker';
import '../styles/globals.css';

export default function Home() {
  return (
    <>
      <Head>
        <title>Lithophane Maker Pro</title>
        <meta
          name="description"
          content="Créer des lithophanies 3D (boules de Noël, cadres, abat-jour) et exporter en STL"
        />
      </Head>
      <main className="app-root">
        <div className="app-container">
          <header className="app-header">
            <h1>Lithophane Maker Pro</h1>
            <p>
              Charge une photo, choisis ta forme, règle les paramètres et exporte directement en STL
              pour l&apos;impression 3D.
            </p>
          </header>
          <LithophaneMaker />
          <footer className="app-footer">
            <p>
              Fait pour l&apos;impression 3D en PLA blanc / translucide • STL généré côté navigateur
              (aucun upload serveur)
            </p>
          </footer>
        </div>
      </main>
    </>
  );
}