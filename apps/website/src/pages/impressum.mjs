import { page } from '../layout.mjs';
// The legal notice of openautark.com and of the app (Austria: ECG § 5, GewO § 63, MedienG §§ 24 and 25): who publishes
// and develops Autark / OpenAutark. The facts are those of Teydra Lab's own imprint (teydralab.com/impressum); the name
// is always written in full. A build-discovered page, linked from every footer (config.mjs maker.imprintUrl).
export default function impressum(rel) {
  return page({ slug: 'impressum', rel, title: 'Imprint', description: 'Legal notice (Impressum) for openautark.com and the open-source app Autark / OpenAutark: created and owned by Stanislaus Hees, published under Teydra Lab (Meral Anna Hees), Salzburg, Austria.', body: () => `

<section class="phero"><div class="wrap">
  <nav class="phero__crumbs" aria-label="Breadcrumb"><a href="/">Autark</a><span>/</span><span>Imprint</span></nav>
  <h1 data-reveal>Imprint <em>(Impressum).</em></h1>
  <p class="lead" data-reveal style="--d:1">Who publishes this website and the app. Information under the Austrian E-Commerce Act (ECG), the Trade Regulation Act (GewO) and section 25 of the Media Act (MedienG).</p>
</div></section>

<section class="section">
  <div class="wrap">
    <div class="layout-doc">
      <nav class="toc" aria-label="On this page">
        <b>On this page</b>
        <a href="#publisher">Publisher</a>
        <a href="#contact">Contact</a>
        <a href="#business">Business details</a>
        <a href="#media">Media disclosure</a>
        <a href="#source">Source code</a>
      </nav>
      <div class="prose">
        <h2 id="publisher">Publisher and media owner</h2>
        <p>Service provider, media owner and publisher (Diensteanbieterin, Medieninhaberin und Herausgeberin):</p>
        <p><strong>Meral Anna Hees (Teydra Lab)</strong><br>Ludwig-Richter-Straße 4a/Top3<br>5026 Salzburg, Austria</p>
        <p>Autark, with its open source code published as OpenAutark, is created and owned by Stanislaus Hees. It is published under Teydra Lab, the sole proprietorship of Meral Anna Hees (Salzburg, Austria), which is the legal publisher and media owner.</p>
        <p lang="de">Autark (der Quellcode als OpenAutark) wurde von Stanislaus Hees entwickelt und gehört ihm. Herausgeberin und Medieninhaberin ist Teydra Lab (Meral Anna Hees).</p>

        <h2 id="contact">Contact</h2>
        <p>General requests: <a href="mailto:hello@teydralab.com">hello@teydralab.com</a><br>Phone: <a href="tel:+4369020070250">+43 690 20070250</a></p>
        <p>Legal and official requests: <a href="mailto:official@teydralab.com">official@teydralab.com</a></p>

        <h2 id="business">Business details</h2>
        <ul>
          <li><strong>Business purpose (Unternehmensgegenstand):</strong> services in automatic data processing and information technology</li>
          <li><strong>GISA number:</strong> 39517807</li>
          <li><strong>Member of:</strong> Wirtschaftskammer Salzburg, Fachgruppe Unternehmensberatung, Buchhaltung und Informationstechnologie (UBIT)</li>
          <li><strong>Professional title:</strong> IT service provider (IT-Dienstleister), awarded in Austria</li>
          <li><strong>Supervisory and trade authority:</strong> Magistrat der Stadt Salzburg</li>
          <li><strong>Applicable law:</strong> Gewerbeordnung (GewO), available at <a href="https://www.ris.bka.gv.at" rel="noopener">www.ris.bka.gv.at</a></li>
        </ul>

        <h2 id="media">Media disclosure</h2>
        <p><strong>Media owner (Medieninhaberin):</strong> Meral Anna Hees, Salzburg, Austria.</p>
        <p><strong>Basic orientation (grundlegende Richtung):</strong> information about Autark, the open-source app that runs a company of AI agents on your own computer: what it does, how to download and use it, its releases, and notes on working with AI agents.</p>

        <h2 id="source">Source code</h2>
        <p>The source code is public at <a href="https://github.com/teydra/OpenAutark" rel="noopener">github.com/teydra/OpenAutark</a> under the Apache License 2.0. How this website and the app handle data is on the <a href="/privacy/">privacy page</a>.</p>
      </div>
    </div>
  </div>
</section>`});
}
