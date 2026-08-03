import { CONSOLE_URL } from '../data';

export function Nav() {
  return (
    <header className="nav">
      <div className="nav__in">
        <a className="mark" href="#top">
          HOPPER
        </a>
        <nav className="nav__links">
          <a href="#boundary">What it does</a>
          <a href="#adoption">Adoption</a>
          <a href="#plans">Plans</a>
        </nav>
        <a className="btn" href={CONSOLE_URL}>
          <span className="btn__tick" />
          Open console
        </a>
      </div>
    </header>
  );
}
