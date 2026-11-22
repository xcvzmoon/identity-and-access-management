<script setup lang="ts">
  import { managementSections } from '~/utils/management';

  const collapsed = useCookie<boolean>('console-sidebar-collapsed', { default: () => false });
  const mobileOpen = ref(false);
  const route = useRoute();
  const searchOpen = ref(false);
  const navigation = [
    ...managementSections,
    {
      label: 'Your account',
      to: '/account',
      icon: 'i-lucide-circle-user-round',
    },
  ];
  const groups = [
    {
      label: 'Workspace',
      items: navigation.filter(({ to }) => ['/dashboard', '/management'].includes(to)),
    },
    {
      label: 'Directory',
      items: navigation.filter(({ to }) => ['/members', '/invitations'].includes(to)),
    },
    {
      label: 'Access control',
      items: navigation.filter(({ to }) => ['/applications', '/access'].includes(to)),
    },
    {
      label: 'Personal',
      items: navigation.filter(({ to }) => to === '/account'),
    },
  ];
  const searchGroups = groups.map((group) => ({
    id: group.label,
    label: group.label,
    items: group.items.map((item) => ({
      ...item,
      onSelect: (): void => {
        searchOpen.value = false;
        mobileOpen.value = false;
      },
    })),
  }));

  defineShortcuts({
    '/': () => {
      searchOpen.value = true;
    },
  });

  const currentPath = computed(() => (route.path === '/' ? '/dashboard' : route.path));
  const currentSection = computed(() => navigation.find(({ to }) => to === currentPath.value));
</script>

<template>
  <UApp>
    <NuxtRouteAnnouncer />

    <div
      v-if="currentSection"
      :class="
        collapsed ? 'md:grid-cols-[4rem_minmax(0,1fr)]' : 'md:grid-cols-[14rem_minmax(0,1fr)]'
      "
      class="min-h-dvh bg-(--iam-surface) antialiased md:grid md:h-dvh md:transition-all motion-reduce:transition-none md:gap-3 md:p-3"
    >
      <a
        href="#console-content"
        class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-default focus:p-3"
      >
        Skip to content
      </a>
      <UModal
        v-model:open="searchOpen"
        title="Find a console page"
      >
        <template #body>
          <UCommandPalette
            :groups="searchGroups"
            placeholder="Search pages…"
            autofocus
          />
        </template>
      </UModal>
      <aside class="min-w-0 px-2 py-3 md:flex md:flex-col md:overflow-y-auto">
        <div class="flex items-center md:mb-5 gap-2.5 px-2 text-sm font-semibold">
          <span class="grid size-7 place-items-center rounded-md bg-inverted text-inverted">
            <UIcon
              name="i-lucide-shield-check"
              class="size-4"
              aria-hidden="true"
            />
          </span>
          <span :class="{ 'md:sr-only': collapsed }">IAM Console</span>
          <UButton
            class="ms-auto md:hidden"
            icon="i-lucide-search"
            color="neutral"
            variant="ghost"
            aria-label="Find a console page"
            @click="searchOpen = true"
          />
          <UButton
            class="md:hidden"
            :aria-expanded="mobileOpen"
            aria-controls="console-nav"
            aria-label="Toggle navigation"
            icon="i-lucide-menu"
            color="neutral"
            variant="ghost"
            @click="mobileOpen = !mobileOpen"
          />
        </div>

        <nav
          id="console-nav"
          :class="mobileOpen ? 'grid' : 'hidden'"
          aria-label="Console"
          class="mt-4 grid-cols-2 gap-5 md:mt-0 md:flex md:flex-1 md:flex-col"
        >
          <div
            v-for="group in groups"
            :key="group.label"
            :class="{
              'md:mt-auto md:border-t md:border-muted md:pt-3': group.label === 'Personal',
            }"
            class="grid content-start gap-1"
          >
            <p
              class="mb-1 px-2 text-xs font-medium text-muted"
              :class="{ 'md:sr-only': collapsed }"
            >
              {{ group.label }}
            </p>
            <UButton
              v-for="{ label, to, icon } in group.items"
              :key="to"
              :to="to"
              @click="mobileOpen = false"
              :aria-label="label"
              :title="label"
              :icon="icon"
              :aria-current="currentPath === to ? 'page' : undefined"
              color="neutral"
              :variant="currentPath === to ? 'solid' : 'ghost'"
              :square="collapsed"
            >
              <span :class="{ 'md:sr-only': collapsed }">{{ label }}</span>
            </UButton>
          </div>
        </nav>
      </aside>

      <main
        id="console-content"
        tabindex="-1"
        class="min-w-0 border-t border-muted bg-default md:rounded-xl md:border md:overflow-y-auto"
      >
        <header
          class="hidden h-12 items-center md:flex gap-2 border-b border-muted px-5 text-sm font-medium sm:px-7"
        >
          <UButton
            class="hidden md:inline-flex"
            aria-controls="console-nav"
            :aria-expanded="!collapsed"
            :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
            :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
            icon="i-lucide-panel-left"
            color="neutral"
            variant="ghost"
            @click="collapsed = !collapsed"
          />
          <USeparator
            orientation="vertical"
            class="h-5"
          />
          <span>{{ currentSection.label }}</span>
          <UButton
            class="ms-auto"
            icon="i-lucide-search"
            color="neutral"
            variant="outline"
            aria-label="Find a console page"
            @click="searchOpen = true"
          >
            Search pages
            <UKbd value="/" />
          </UButton>
        </header>

        <div class="w-full px-4 py-5 sm:px-6 lg:py-6">
          <NuxtPage />
        </div>
      </main>
    </div>

    <main
      v-else
      class="mx-auto grid min-h-dvh max-w-md content-center px-6 py-12 antialiased"
    >
      <NuxtPage />
    </main>
  </UApp>
</template>
