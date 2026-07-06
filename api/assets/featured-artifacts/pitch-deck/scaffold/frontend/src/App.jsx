import { useState, useEffect } from 'react';

import Title from './slides/Title.jsx';
import Problem from './slides/Problem.jsx';
import Solution from './slides/Solution.jsx';
import Market from './slides/Market.jsx';
import Product from './slides/Product.jsx';
import Traction from './slides/Traction.jsx';
import BusinessModel from './slides/BusinessModel.jsx';
import Competition from './slides/Competition.jsx';
import Team from './slides/Team.jsx';
import Roadmap from './slides/Roadmap.jsx';
import Ask from './slides/Ask.jsx';
import ThankYou from './slides/ThankYou.jsx';

const SLIDES = [
  Title,
  Problem,
  Solution,
  Market,
  Product,
  Traction,
  BusinessModel,
  Competition,
  Team,
  Roadmap,
  Ask,
  ThankYou,
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
