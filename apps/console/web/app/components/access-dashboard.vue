<script setup lang="ts">
  import type { OrganizationDetails } from '~/utils/management';

  type Props = { details: OrganizationDetails; organizationId: string };

  const NO_MEMBERS = 0;
  const FIRST_INDEX = 0;
  const FIRST_RANK = 1;
  const PREVIEW_LIMIT = 5;
  const PERCENT = 100;
  const props = defineProps<Props>();
  const total = computed(() => props.details.members.length);
  const assignedMembers = computed(() => {
    const assigned = new Set(props.details.assignments.map(({ userId }) => userId));

    return props.details.members.filter(({ userId }) => assigned.has(userId)).length;
  });
  const pending = computed(() =>
    props.details.invitations.filter(({ status }) => status === 'pending'),
  );
  const administrators = computed(() =>
    props.details.members.filter(({ role }) => role === 'owner' || role === 'admin'),
  );
  const applications = computed(() => {
    const directory = new Set(props.details.members.map(({ userId }) => userId));
    const access = new Map<string, Set<string>>();

    for (const { clientId, userId } of props.details.assignments) {
      if (directory.has(userId)) {
        const members = access.get(clientId) ?? new Set<string>();
        members.add(userId);
        access.set(clientId, members);
      }
    }

    return props.details.installations
      .map(({ clientId, name }) => ({
        clientId,
        name,
        assigned: access.get(clientId)?.size ?? NO_MEMBERS,
      }))
      .toSorted(
        (left, right) => right.assigned - left.assigned || left.name.localeCompare(right.name),
      );
  });
  const coverage = computed(() => [
    {
      label: 'Assigned',
      members: assignedMembers.value,
    },
    {
      label: 'Unassigned',
      members: total.value - assignedMembers.value,
    },
  ]);
  const topApps = computed(() =>
    applications.value
      .slice(FIRST_INDEX, PREVIEW_LIMIT)
      .map(({ clientId, name, assigned }, index) => ({
        clientId,
        name,
        assigned,
        rank: String(index + FIRST_RANK),
      })),
  );
  const metrics = computed(() => [
    {
      name: 'Members',
      value: total.value,
      note: 'Organization directory',
      icon: 'i-lucide-users',
      path: '/members',
    },
    {
      name: 'Applications',
      value: applications.value.length,
      note: 'Registered installations',
      icon: 'i-lucide-blocks',
      path: '/applications',
    },
    {
      name: 'Role assignments',
      value: props.details.assignments.length,
      note: 'Application access grants',
      icon: 'i-lucide-key-round',
      path: '/access',
    },
    {
      name: 'Pending invitations',
      value: pending.value.length,
      note: 'Awaiting acceptance',
      icon: 'i-lucide-mail',
      path: '/invitations',
    },
  ]);
  const roster = ref('administrators');
</script>

<template>
  <div class="grid min-w-0 gap-4 sm:gap-5">
    <nav
      class="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:gap-5"
      aria-label="Organization metrics"
    >
      <NuxtLink
        v-for="metric in metrics"
        :key="metric.path"
        :to="{ path: metric.path, query: { org: organizationId } }"
        class="group grid min-w-0 content-start gap-3 rounded-lg border border-muted bg-muted p-4 transition-all hover:border-accented sm:p-5"
      >
        <span
          class="flex min-h-10 items-start justify-between gap-2 text-sm font-medium text-muted sm:min-h-5"
        >
          {{ metric.name }}
          <UIcon
            :name="metric.icon"
            class="size-4 shrink-0 text-muted"
          />
        </span>
        <strong
          class="text-3xl leading-none font-semibold tracking-tight text-highlighted tabular-nums sm:text-4xl"
        >
          {{ metric.value }}
        </strong>
        <span class="hidden text-xs text-muted sm:block">{{ metric.note }}</span>
      </NuxtLink>
    </nav>

    <div class="grid items-stretch gap-4 sm:gap-5 lg:grid-cols-2">
      <section
        class="grid min-w-0 content-between gap-5 rounded-lg border border-muted bg-muted p-5 sm:p-6"
      >
        <header>
          <h2 class="text-lg font-semibold tracking-tight">Member coverage</h2>
          <p class="mt-1 text-sm text-muted">Members with access to at least one application</p>
        </header>
        <template v-if="total">
          <div class="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)]">
            <UChart
              type="donut"
              index="label"
              :data="coverage"
              :categories="['members']"
              :colors="['var(--ui-bg-inverted)', 'var(--ui-border-accented)']"
              :height="174"
              :thickness="17"
              :legend="false"
              aria-label="Member access coverage"
            >
              <template #center>
                <strong class="text-3xl font-semibold tracking-tight tabular-nums">
                  {{ Math.round((assignedMembers / total) * PERCENT) }}%
                </strong>
              </template>
            </UChart>
            <dl class="grid grid-cols-2 gap-4 sm:grid-cols-1">
              <div
                v-for="(slice, index) in coverage"
                :key="slice.label"
                class="grid gap-1"
              >
                <dt class="flex items-center gap-2 text-sm text-muted">
                  <span
                    class="size-2 rounded-full"
                    :class="index === 0 ? 'bg-inverted' : 'bg-(--ui-border-accented)'"
                  />
                  {{ slice.label }}
                </dt>
                <dd class="pl-4 text-xl font-medium tabular-nums">{{ slice.members }}</dd>
              </div>
            </dl>
          </div>
        </template>
        <UEmpty
          v-else
          icon="i-lucide-users"
          title="No members yet"
        />
        <div class="border-t border-muted pt-3">
          <ULink
            :to="{ path: '/access', query: { org: organizationId } }"
            class="text-sm"
          >
            Review assignments →
          </ULink>
        </div>
      </section>
      <section
        class="grid min-w-0 content-start gap-4 rounded-lg border border-muted bg-muted p-5 sm:p-6"
      >
        <header class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold tracking-tight">Access by application</h2>
            <p class="mt-1 text-sm text-muted">Installed applications ranked by assigned members</p>
          </div>
          <ULink
            :to="{ path: '/applications', query: { org: organizationId } }"
            class="shrink-0 text-sm"
          >
            View all
          </ULink>
        </header>
        <template v-if="topApps.length">
          <UChart
            type="bar"
            index="rank"
            :data="topApps"
            :categories="[{ key: 'assigned', label: 'Assigned members' }]"
            :colors="['var(--ui-bg-inverted)']"
            :height="134"
            aria-label="Assigned members by application rank"
          />
          <ol class="grid gap-1">
            <li
              v-for="app in topApps"
              :key="app.clientId"
            >
              <NuxtLink
                :to="{
                  path: '/applications',
                  query: { org: organizationId, client: app.clientId },
                }"
                class="flex items-center gap-3 rounded py-1 text-sm transition-colors hover:text-primary"
              >
                <span class="font-mono text-xs text-muted">{{ app.rank }}</span>
                <span class="min-w-0 flex-1 truncate">{{ app.name }}</span>
                <strong class="tabular-nums">{{ app.assigned }}</strong>
                <UIcon
                  name="i-lucide-chevron-right"
                  class="text-muted"
                />
              </NuxtLink>
            </li>
          </ol>
        </template>
        <UEmpty
          v-else
          icon="i-lucide-blocks"
          title="No applications registered"
        />
      </section>
    </div>

    <section class="min-w-0 rounded-lg border border-muted bg-muted">
      <div
        class="flex flex-wrap items-center justify-between gap-3 border-b border-muted px-4 py-3 sm:px-5"
      >
        <UTabs
          v-model="roster"
          color="neutral"
          :content="false"
          :items="[
            { value: 'administrators', label: 'Administrators', icon: 'i-lucide-shield-check' },
            { value: 'invitations', label: 'Invitations', icon: 'i-lucide-mail' },
          ]"
          aria-label="Directory preview"
        />
        <ULink
          :to="{
            path: roster === 'invitations' ? '/invitations' : '/members',
            query: { org: organizationId },
          }"
          class="text-sm"
        >
          View directory →
        </ULink>
      </div>
      <ul
        v-if="roster === 'administrators' && administrators.length"
        class="divide-y divide-muted px-4 sm:px-5"
      >
        <li
          v-for="member in administrators.slice(0, PREVIEW_LIMIT)"
          :key="member.userId"
          class="flex items-center gap-3 py-3"
        >
          <UAvatar
            :alt="member.name || member.email"
            size="sm"
          />
          <div class="min-w-0 flex-1 text-sm">
            <strong class="block truncate font-medium">{{ member.name || member.email }}</strong>
            <span
              v-if="member.name"
              class="block truncate text-xs text-muted"
            >
              {{ member.email }}
            </span>
          </div>
          <UBadge
            color="neutral"
            :variant="member.role === 'owner' ? 'solid' : 'subtle'"
          >
            {{ member.role }}
          </UBadge>
        </li>
      </ul>
      <ul
        v-else-if="roster === 'invitations' && pending.length"
        class="divide-y divide-muted px-4 sm:px-5"
      >
        <li
          v-for="(invitation, index) in pending.slice(0, PREVIEW_LIMIT)"
          :key="index"
          class="flex items-center gap-3 py-3"
        >
          <UAvatar
            icon="i-lucide-mail"
            size="sm"
          />
          <div class="min-w-0 flex-1 text-sm">
            <strong class="block truncate font-medium">{{ invitation.email }}</strong>
            <span class="text-xs text-muted">Invited as {{ invitation.role }}</span>
          </div>
          <UBadge
            color="neutral"
            variant="subtle"
          >
            Pending
          </UBadge>
        </li>
      </ul>
      <UEmpty
        v-else
        :title="roster === 'invitations' ? 'No pending invitations' : 'No administrators listed'"
      />
    </section>
  </div>
</template>
