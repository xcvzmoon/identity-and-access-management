<script setup lang="ts">
  type Props = { isSidebarCollapsed: boolean };

  const props = defineProps<Props>();
  const emit = defineEmits<{ navigate: [] }>();

  const route = useRoute();
  const sidebarRoutes = [
    {
      label: 'Workspace',
      items: [
        {
          label: 'Dashboard',
          to: '/dashboard',
          icon: 'i-lucide-layout-dashboard',
        },
        {
          label: 'Organizations',
          to: '/management',
          icon: 'i-lucide-diagram-flow-horizontal',
        },
      ],
    },
    {
      label: 'Directory',
      items: [
        {
          label: 'Members',
          to: '/members',
          icon: 'i-lucide-users',
        },
        {
          label: 'Invitations',
          to: '/invitations',
          icon: 'i-lucide-mail-plus',
        },
      ],
    },
    {
      label: 'Access control',
      items: [
        {
          label: 'Applications',
          to: '/applications',
          icon: 'i-lucide-blocks',
        },
        {
          label: 'Roles & access',
          to: '/access',
          icon: 'i-lucide-key-round',
        },
      ],
    },
    {
      label: 'Personal',
      items: [
        {
          label: 'Your account',
          to: '/account',
          icon: 'i-lucide-circle-user-round',
        },
      ],
    },
  ];
</script>

<template>
  <aside
    :class="props.isSidebarCollapsed ? 'w-17.5' : 'w-72'"
    class="h-[inherit] shrink-0 overflow-y-auto transition-[width]"
  >
    <div class="p-4.75">
      <div class="flex items-center mb-4">
        <img
          src="~/assets/img/icon.png"
          alt="IAM Icon"
          class="size-8"
        />

        <h1
          :class="props.isSidebarCollapsed ? 'm-0 h-0 opacity-0' : 'ml-2 h-5 opacity-100'"
          class="text-sm font-medium transition-all truncate"
        >
          Identity & Access Management
        </h1>
      </div>

      <div
        v-for="(group, index) in sidebarRoutes"
        :key="group.label"
        :class="!props.isSidebarCollapsed && index !== 0 ? 'mt-4' : 'mt-1'"
        class="transition-[margin]"
      >
        <p
          :class="props.isSidebarCollapsed ? 'mb-0 h-0 opacity-0' : 'h-5 opacity-100 mb-1'"
          class="text-sm text-muted transition-all"
        >
          {{ group.label }}
        </p>

        <ul class="space-y-1">
          <li
            v-for="{ label, to, icon } in group.items"
            :key="to"
          >
            <UTooltip
              :text="label"
              :disabled="!props.isSidebarCollapsed"
              :content="{
                side: 'right',
              }"
              :delay-duration="0"
            >
              <UButton
                :variant="route.path === to ? undefined : 'ghost'"
                :color="route.path === to ? 'primary' : 'neutral'"
                :to="to"
                :icon="icon"
                :label="props.isSidebarCollapsed ? undefined : label"
                :aria-label="label"
                class="w-full px-2"
                @click="emit('navigate')"
              />
            </UTooltip>
          </li>
        </ul>
      </div>
    </div>
  </aside>
</template>
