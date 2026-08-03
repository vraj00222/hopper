import { Rail } from './components';
import { Adoption } from './sections/Adoption';
import { Boundary } from './sections/Boundary';
import { Foot } from './sections/Foot';
import { Hero } from './sections/Hero';
import { Join } from './sections/Join';
import { Nav } from './sections/Nav';
import { Plans } from './sections/Plans';
import { Precedent } from './sections/Precedent';
import { Volume } from './sections/Volume';

export default function App() {
  return (
    <>
      <a className="skip" href="#volume">
        Skip the demo
      </a>
      <div id="top" />
      <Nav />
      <Rail />
      <main>
        <Hero />
        <Volume />
        <Boundary />
        <Precedent />
        <Join />
        <Adoption />
        <Plans />
      </main>
      <Foot />
    </>
  );
}
