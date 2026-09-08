// Minimal history-API router. Routes are matched on pathname only.

let pathname = $state(window.location.pathname);

window.addEventListener('popstate', () => {
  pathname = window.location.pathname;
});

export const router = {
  get pathname() {
    return pathname;
  },
  navigate(path: string) {
    if (path === pathname) return;
    window.history.pushState(null, '', path);
    pathname = path;
  },
};
