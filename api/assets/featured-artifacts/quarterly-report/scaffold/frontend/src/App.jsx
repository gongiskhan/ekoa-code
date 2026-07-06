import { useState, useEffect } from 'react';

import Title from './slides/Title.jsx';
import Highlights from './slides/Highlights.jsx';
import Revenue from './slides/Revenue.jsx';
import Customers from './slides/Customers.jsx';
import Product from './slides/Product.jsx';
import Operations from './slides/Operations.jsx';
import Challenges from './slides/Challenges.jsx';
import Q4Plan from './slides/Q4Plan.jsx';
import Closing from './slides/Closing.jsx';

const SLIDES = [
  Title,
  Highlights,
  Revenue,
  Customers,
  Product,
  Operations,
  Challenges,
  Q4Plan,
  Closing,
];

export default function App() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        setI((n) => Math.min(n + 1, SLIDES.length - 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setI((n) => Math.max(0, n - 1));
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        const el = document.documentElement;
        if (!document.fullscreenElement) {
          el.requestFullscreen?.();
        } else {
          document.exitFullscreen?.();
        }
      } else if (e.key === 'Home') {
        setI(0);
      } else if (e.key === 'End') {
        setI(SLIDES.length - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const Slide = SLIDES[i];

  return (
    <div className="deck">
      <div className="deck-stage">
        <Slide />
      </div>

      <div className="deck-chrome">
        <div className="deck-progress" aria-hidden="true">
          <div
            className="deck-progress-bar"
            style={{ width: `${((i + 1) / SLIDES.length) * 100}%` }}
          />
        </div>
        <div className="deck-meta">
          <span className="deck-hint">Veja com as setas &larr; &rarr; &middot; F para ecra inteiro</span>
          <span className="deck-page">
            {String(i + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}
          </span>
        </div>
      </div>
    </div>
  );
}
