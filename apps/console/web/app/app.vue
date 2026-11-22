<script setup lang="ts">
  const isSidebarCollapsed = useCookie('sidebar:is-collapsed', {
    default: () => false,
    watch: true,
  });

  const route = useRoute();
</script>

<template>
  <UApp>
    <div
      v-if="route.path !== '/signed-out'"
      class="h-svh dark:bg-zinc-950/20 bg-zinc-50/80 flex"
    >
      <Sidebar
        :is-sidebar-collapsed="isSidebarCollapsed"
        class="hidden md:block"
      />

      <div class="min-w-0 flex-1 md:p-1.5 md:pl-0">
        <div
          class="flex size-full flex-col rounded-lg border border-transparent bg-default md:border-default"
        >
          <Header v-model:is-sidebar-collapsed="isSidebarCollapsed" />

          <div class="min-h-0 flex-1 overflow-auto p-4">
            <NuxtPage />
          </div>
        </div>
      </div>
    </div>

    <main
      v-else
      class="mx-auto grid min-h-svh max-w-md content-center px-6 py-12"
    >
      <NuxtPage />
    </main>
  </UApp>
</template>
