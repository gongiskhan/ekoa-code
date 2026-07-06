import Hero from './components/Hero';
import Work from './components/Work';
import About from './components/About';
import Services from './components/Services';
import Team from './components/Team';
import Contact from './components/Contact';
import Footer from './components/Footer';

export default function App() {
  return (
    <div className="page">
      <main>
        <Hero />
        <Work />
        <About />
        <Services />
        <Team />
        <Contact />
      </main>
      <Footer />
    </div>
  );
}
