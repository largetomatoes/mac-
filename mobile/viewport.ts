import { useEffect } from 'react';

export function useMobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      document.documentElement.style.setProperty('--mobile-height', `${viewport?.height || window.innerHeight}px`);
      document.documentElement.style.setProperty('--mobile-top', `${viewport?.offsetTop || 0}px`);
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
}

/** Radix owns the overlay stack, so Escape dismisses only its topmost layer. */
export function dismissMobileLayer() {
  const layers = document.querySelectorAll<HTMLElement>('[data-slot="dialog-content"][data-state="open"], [data-slot="sheet-content"][data-state="open"], [data-slot="alert-dialog-content"][data-state="open"]');
  const search = document.querySelector<HTMLElement>('.book-search-panel');
  if (search && (layers.length === 0 || layers.length === 1 && layers[0].classList.contains('library-dialog'))) { search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true; }
  if (!layers.length) return false;
  layers[layers.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return true;
}
