<script setup lang="ts">
  const isSidebarCollapsed = defineModel<boolean>('isSidebarCollapsed', { required: true });
  const route = useRoute();
  const isSidebarDrawerOpen = shallowRef(false);

  function closeDrawerOnDesktop(event: MediaQueryListEvent): void {
    if (event.matches) {
      isSidebarDrawerOpen.value = false;
    }
  }

  onMounted(() => {
    const desktop = globalThis.matchMedia('(min-width: 48rem)');

    desktop.addEventListener('change', closeDrawerOnDesktop);
    onUnmounted(() => desktop.removeEventListener('change', closeDrawerOnDesktop));
  });
</script>

<template>
  <header class="p-3 border-b border-default flex items-center justify-between">
    <div class="flex items-center gap-3">
      <UButton
        :icon="isSidebarCollapsed ? 'i-lucide-panel-right-close' : 'i-lucide-panel-left-close'"
        :aria-label="isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-expanded="!isSidebarCollapsed"
        class="hidden md:inline-flex"
        color="neutral"
        size="icon-md"
        variant="ghost"
        @click="isSidebarCollapsed = !isSidebarCollapsed"
      />

      <UDrawer
        v-model:open="isSidebarDrawerOpen"
        title="Console navigation"
        direction="left"
        :handle="false"
        :ui="{ content: 'w-72 max-w-full rounded-none' }"
      >
        <UButton
          icon="i-lucide-menu"
          aria-label="Open navigation"
          color="neutral"
          size="icon-md"
          variant="ghost"
          class="md:hidden"
        />

        <template #content>
          <Sidebar
            :is-sidebar-collapsed="false"
            class="max-w-full"
            @navigate="isSidebarDrawerOpen = false"
          />
        </template>
      </UDrawer>

      <USeparator
        orientation="vertical"
        class="h-4 bg-default"
      />

      <p class="text-sm ml-2">{{ route.name }}</p>
    </div>

    <div class="flex items-center gap-2">
      <UPopover
        :content="{
          side: 'bottom',
          align: 'end',
          sideOffset: 8,
          collisionPadding: 8,
        }"
      >
        <UButton
          :ui="{
            leadingAvatar: 'size-5',
          }"
          :avatar="{
            icon: 'i-lucide-image',
            src: 'https://avatars.githubusercontent.com/u/67058406?v=4',
            loading: 'lazy',
          }"
          size="icon-md"
          color="neutral"
          variant="ghost"
        />

        <template #content>
          <div class="w-52 rounded-[inherit] dark:bg-zinc-950/20 bg-zinc-50/80">
            <div class="p-3 border-b border-default flex items-center gap-3">
              <UAvatar
                src="https://avatars.githubusercontent.com/u/67058406?v=4"
                icon="i-lucide-image"
                loading="lazy"
              />

              <div class="flex-1">
                <p class="text-sm">Mon Albert Gamil</p>
                <p class="text-xs text-muted">Software Engineer</p>
              </div>
            </div>

            <div class="p-3 space-y-1">
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-user"
                label="Profile"
                class="w-full"
              />

              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-log-out"
                label="Sign out"
                class="w-full"
              />
            </div>
          </div>
        </template>
      </UPopover>
    </div>
  </header>
</template>
