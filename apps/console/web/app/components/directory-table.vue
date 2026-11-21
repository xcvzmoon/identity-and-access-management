<script setup lang="ts">
  import type { RouteLocationRaw } from 'vue-router';
  import type { OrganizationDetails } from '~/utils/management';

  type Row = {
    identity: string;
    detail: string;
    access: string;
    filter?: string;
    permissions?: string;
    clientId?: string;
  };
  type Directory = {
    title: string;
    detail: string;
    identity: string;
    access: string;
    filter?: string;
    rows: Row[];
  };
  type Props = { path: string; details: OrganizationDetails; organizationId: string };

  const props = defineProps<Props>();
  const PAGE_SIZE = 15;
  const FIRST_PAGE = 1;
  const layout = ref('cards');
  const layouts = [
    {
      label: 'Cards',
      value: 'cards',
      icon: 'i-lucide-layout-grid',
    },
    {
      label: 'List',
      value: 'list',
      icon: 'i-lucide-list',
    },
  ];
  const query = ref('');
  const facet = ref('');
  const page = ref(FIRST_PAGE);
  const directory = computed<Directory>(() => {
    const { members, installations, invitations, assignments } = props.details;
    if (props.path === '/members') {
      return {
        title: 'Member directory',
        detail: 'Email address',
        identity: 'Member',
        access: 'Organization role',
        filter: 'All roles',
        rows: members.map(({ name, email, role }) => ({
          identity: name || email,
          detail: email,
          access: role,
          filter: role,
        })),
      };
    }

    if (props.path === '/invitations') {
      return {
        title: 'Invitation history',
        detail: 'Invited role',
        identity: 'Recipient',
        access: 'Invitation status',
        filter: 'All statuses',
        rows: invitations.map(({ email, role, status }) => ({
          identity: email,
          detail: role,
          access: status,
          filter: status,
        })),
      };
    }

    if (props.path === '/applications') {
      return {
        title: 'Application directory',
        detail: 'Client ID',
        identity: 'Application',
        access: 'Installation roles',
        rows: installations.map(({ name, clientId, rolePermissions }) => ({
          identity: name,
          detail: clientId,
          clientId,
          permissions: Object.values(rolePermissions).flat().join(', '),
          access: Object.keys(rolePermissions).join(', ') || 'No roles defined',
        })),
      };
    }

    const emails = new Map(members.map(({ userId, email }) => [userId, email]));
    const names = new Map(installations.map(({ clientId, name }) => [clientId, name]));
    return {
      title: 'Role assignments',
      detail: 'Application',
      identity: 'Member',
      access: 'Assigned role',
      filter: 'All applications',
      rows: assignments.map(({ userId, clientId, role }) => ({
        identity: emails.get(userId) ?? userId,
        detail: names.get(clientId) ?? clientId,
        access: role,
        filter: clientId,
        clientId,
      })),
    };
  });
  const options = computed(() => {
    const values = new Map<string, string>();
    for (const row of directory.value.rows) {
      if (row.filter) {
        values.set(row.filter, props.path === '/access' ? row.detail : row.filter);
      }
    }

    return [...values]
      .map(([value, label]) => ({ value, label }))
      .toSorted((left, right) => left.label.localeCompare(right.label));
  });
  const columns = computed(() => [
    {
      accessorKey: 'identity',
      header: directory.value.identity,
    },
    {
      accessorKey: 'detail',
      header: directory.value.detail,
    },
    {
      accessorKey: 'access',
      header: directory.value.access,
    },
  ]);
  const filtered = computed(() => {
    const term = query.value.trim().toLocaleLowerCase();
    return directory.value.rows.filter(
      (row) =>
        (!facet.value || row.filter === facet.value) &&
        [row.identity, row.detail, row.access, row.permissions ?? ''].some((value) =>
          value.toLocaleLowerCase().includes(term),
        ),
    );
  });
  const visible = computed(() =>
    filtered.value.slice((page.value - FIRST_PAGE) * PAGE_SIZE, page.value * PAGE_SIZE),
  );
  watch([query, facet], () => {
    page.value = FIRST_PAGE;
  });
  watch(
    () => filtered.value.length,
    (length) => {
      page.value = Math.min(page.value, Math.max(FIRST_PAGE, Math.ceil(length / PAGE_SIZE)));
    },
  );

  function applicationLink(client: string): RouteLocationRaw {
    return {
      path: '/applications',
      query: {
        org: props.organizationId,
        client,
      },
    };
  }
</script>

<template>
  <section class="min-w-0 overflow-hidden rounded-lg border border-muted bg-(--iam-surface)">
    <header
      class="flex flex-wrap items-center justify-between gap-3 border-b border-muted p-4 sm:px-5"
    >
      <div class="flex items-center gap-2">
        <h2 class="text-lg font-medium">{{ directory.title }}</h2>
        <UBadge
          color="neutral"
          variant="subtle"
        >
          {{ filtered.length }}
        </UBadge>
      </div>
      <div class="flex max-w-full flex-wrap items-center gap-2">
        <UTabs
          v-if="path === '/applications'"
          v-model="layout"
          :items="layouts"
          :content="false"
          color="neutral"
          size="sm"
          aria-label="Application directory layout"
        />
        <UInput
          v-model="query"
          icon="i-lucide-search"
          :placeholder="'Search ' + directory.title.toLowerCase()"
          :aria-label="'Search ' + directory.title.toLowerCase()"
        />
        <USelect
          v-if="directory.filter && options.length"
          :model-value="facet || undefined"
          :items="options"
          :placeholder="directory.filter"
          :aria-label="directory.filter"
          @update:model-value="facet = $event ?? ''"
        />
        <UButton
          v-if="facet || query"
          variant="ghost"
          color="neutral"
          @click="
            query = '';
            facet = '';
          "
        >
          Clear
        </UButton>
      </div>
    </header>
    <div
      v-if="path === '/applications' && layout === 'cards' && visible.length"
      class="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3"
    >
      <article
        v-for="row in visible"
        :key="row.detail"
        class="relative grid min-w-0 gap-4 rounded-lg border border-muted bg-default p-4 transition-all hover:border-accented focus-within:border-accented"
      >
        <div class="flex items-center justify-between">
          <UIcon
            name="i-lucide-blocks"
            class="size-5 text-highlighted"
          />
          <UIcon
            name="i-lucide-arrow-up-right"
            class="size-4 text-muted"
          />
        </div>
        <div>
          <NuxtLink
            :to="applicationLink(row.detail)"
            class="break-words text-base font-semibold text-highlighted after:absolute after:inset-0 after:rounded-lg"
          >
            {{ row.identity }}
          </NuxtLink>
          <p class="mt-1 break-all font-mono text-xs text-muted">{{ row.detail }}</p>
        </div>
        <div class="border-t border-muted pt-3 text-sm">
          <span class="me-2 text-muted">Roles</span>
          {{ row.access }}
        </div>
      </article>
    </div>
    <template v-else>
      <div class="hidden sm:block">
        <UTable
          :columns="columns"
          :data="visible"
          :empty="query || facet ? 'No matches for these filters.' : 'No entries yet.'"
        >
          <template #identity-cell="{ row }">
            <div class="flex items-center gap-3">
              <UAvatar
                v-if="path === '/members'"
                :alt="row.original.identity"
                size="sm"
              />
              <ULink
                v-if="path === '/applications' && row.original.clientId"
                :to="applicationLink(row.original.clientId)"
              >
                {{ row.original.identity }}
              </ULink>
              <strong
                v-else
                class="font-medium text-highlighted"
              >
                {{ row.original.identity }}
              </strong>
            </div>
          </template>
          <template #detail-cell="{ row }">
            <ULink
              v-if="path === '/access' && row.original.clientId"
              :to="applicationLink(row.original.clientId)"
            >
              {{ row.original.detail }}
            </ULink>
            <span
              v-else
              class="text-xs text-muted"
            >
              {{ row.original.detail }}
            </span>
          </template>
          <template #access-cell="{ row }">
            <UBadge
              v-if="path === '/invitations'"
              color="neutral"
              :variant="row.original.access === 'accepted' ? 'solid' : 'subtle'"
            >
              {{ row.original.access }}
            </UBadge>
            <span
              v-else
              class="whitespace-normal"
            >
              {{ row.original.access }}
            </span>
          </template>
        </UTable>
      </div>
      <ul
        v-if="visible.length"
        class="divide-y divide-muted px-4 sm:hidden"
      >
        <li
          v-for="(row, index) in visible"
          :key="index"
          class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 py-3 text-sm wrap-anywhere"
        >
          <UAvatar
            class="row-span-3"
            :alt="row.identity"
            :icon="
              path === '/members'
                ? undefined
                : path === '/applications'
                  ? 'i-lucide-blocks'
                  : path === '/invitations'
                    ? 'i-lucide-mail'
                    : 'i-lucide-key-round'
            "
            size="sm"
          />
          <ULink
            v-if="path === '/applications' && row.clientId"
            :to="applicationLink(row.clientId)"
          >
            {{ row.identity }}
          </ULink>
          <strong
            v-else
            class="font-medium"
          >
            {{ row.identity }}
          </strong>
          <ULink
            v-if="path === '/access' && row.clientId"
            :to="applicationLink(row.clientId)"
          >
            {{ row.detail }}
          </ULink>
          <span
            v-else
            class="text-muted"
          >
            {{ row.detail }}
          </span>
          <div>
            <UBadge
              v-if="path === '/invitations'"
              color="neutral"
              :variant="row.access === 'accepted' ? 'solid' : 'subtle'"
            >
              {{ row.access }}
            </UBadge>
            <span v-else>{{ directory.access }} · {{ row.access }}</span>
          </div>
        </li>
      </ul>
      <p
        v-else
        class="p-4 text-sm text-muted sm:hidden"
      >
        {{ query || facet ? 'No matches for these filters.' : 'No entries yet.' }}
      </p>
    </template>
    <div
      v-if="filtered.length > PAGE_SIZE"
      class="flex flex-wrap items-center justify-between gap-3 border-t border-muted p-4"
    >
      <span class="text-sm text-muted">
        {{ (page - 1) * PAGE_SIZE + 1 }}–{{ Math.min(page * PAGE_SIZE, filtered.length) }} of
        {{ filtered.length }}
      </span>
      <UPagination
        v-model:page="page"
        :items-per-page="PAGE_SIZE"
        :total="filtered.length"
        :sibling-count="0"
        :show-edges="false"
      />
    </div>
  </section>
</template>
