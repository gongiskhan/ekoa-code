// Example slide - replace with the deck's real title slide (and delete this comment).
// Composition to keep: a short display h1 (two lines at most), one supporting subline,
// and the meta row last (orador, equipa ou empresa, data).
export default function Title() {
  return (
    <section className="slide slide-title">
      <h1>Título da apresentação de exemplo</h1>
      <p className="slide-subline">
        Substitua este slide pelo tema real do deck: uma frase curta de enquadramento.
      </p>
      <p className="slide-title-meta">Nome do orador · Equipa ou empresa · 2026</p>
    </section>
  );
}
