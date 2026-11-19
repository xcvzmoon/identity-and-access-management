import type { RouteLocationNormalized, RouterScrollBehavior } from 'vue-router';

function scrollBehavior(
  to: RouteLocationNormalized,
  _from: RouteLocationNormalized,
  savedPosition: ScrollToOptions | null,
): ReturnType<RouterScrollBehavior> {
  if (savedPosition) {
    return savedPosition;
  }

  if (to.hash && to.path !== '/invite') {
    const id = to.hash.replace(/^#/u, '');
    const element = document.querySelector(`#${CSS.escape(id)}`);

    if (element) {
      return { el: element };
    }
  }

  return { top: 0 };
}

export default { scrollBehavior };
