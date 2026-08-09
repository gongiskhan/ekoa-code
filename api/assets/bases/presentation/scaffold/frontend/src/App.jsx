/**
 * Presentation shell - platform-provided.
 *
 * AGENT: the deck's CONTENT lives in ./slides/ - one component per slide, listed in
 * ./slides/index.js (see the mustEdit note there). Don't rebuild this shell; it already
 * implements keyboard navigation (arrows, space, PageUp/PageDown, F fullscreen), quiet
 * SVG chevron controls, the tabular numeric readout, and the bottom-edge progress bar.
 * Slide layout classes live in index.css: .slide-title, .slide-section, .slide-content,
 * .slide-two-col, .slide-figure, .slide-statement, .slide-closing.
 */
import { useCallback, useEffect, useState } from 'react';
import { slides } from './slides';

function ChevronLeftIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export default function App() {
  const [index, setIndex] = useState(0);
  const total = slides.length;

  const goTo = useCallback((next) => {
    setIndex((current) => {
      const clamped = Math.min(Math.max(next, 0), total - 1);
      return clamped;
    });
  }, [total]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        goTo(index + 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goTo(index - 1);
      } else if (event.key === 'f' || event.key === 'F') {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          document.documentElement.requestFullscreen?.();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goTo, index]);

  const Slide = slides[index];

  if (!Slide) {
    return (
      <div className="deck-empty">
        Nenhum slide definido em frontend/src/slides/index.js.
      </div>
    );
  }

  return (
    <div className="deck">
      <main className="deck-stage">
        <div className="deck-slide-wrap" key={index}>
          <Slide />
        </div>
      </main>
      <button
        type="button"
        className="deck-nav deck-nav-prev"
        onClick={() => goTo(index - 1)}
        disabled={index === 0}
        aria-label="Slide anterior"
      >
        <ChevronLeftIcon />
      </button>
      <button
        type="button"
        className="deck-nav deck-nav-next"
        onClick={() => goTo(index + 1)}
        disabled={index === total - 1}
        aria-label="Próximo slide"
      >
        <ChevronRightIcon />
      </button>
      <div className="deck-pagination" aria-live="polite">
        {index + 1} / {total}
      </div>
      <div className="deck-progress" aria-hidden="true">
        {/* Scaled, not resized: the fill is full-width and transforms on the
            compositor, so advancing a slide never triggers layout. */}
        <div
          className="deck-progress-fill"
          style={{ transform: `scaleX(${(index + 1) / total})` }}
        />
      </div>
    </div>
  );
}
