import { useState, useEffect } from "react";

const PHRASES = [
  "how you work",
  "how your team collaborates",
  "how your industry operates",
  "the way things are done",
];

export default function App() {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setPhraseIndex((i) => (i + 1) % PHRASES.length);
        setFade(true);
      }, 400);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="scaffold-root">
      <div className="scaffold-content">
        <div className="scaffold-logo">
          <svg width="48" height="48" viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="56" stroke="#0d9488" strokeWidth="4" opacity="0.2" />
            <circle cx="60" cy="60" r="40" stroke="#0d9488" strokeWidth="3" opacity="0.4" />
            <circle cx="60" cy="60" r="24" fill="#0d9488" opacity="0.9" />
            <circle cx="60" cy="60" r="10" fill="white" />
          </svg>
        </div>

        <h1 className="scaffold-title">
          Let's build something that will change
        </h1>

        <p className={`scaffold-phrase ${fade ? "visible" : ""}`}>
          {PHRASES[phraseIndex]}
        </p>

        <div className="scaffold-divider" />

        <p className="scaffold-subtitle">
          Your app is being created right now. Watch it come to life.
        </p>

        <div className="scaffold-dots">
          <span className="dot" style={{ animationDelay: "0s" }} />
          <span className="dot" style={{ animationDelay: "0.2s" }} />
          <span className="dot" style={{ animationDelay: "0.4s" }} />
        </div>
      </div>

      <p className="scaffold-footer">
        Powered by Ekoa
      </p>
    </div>
  );
}
