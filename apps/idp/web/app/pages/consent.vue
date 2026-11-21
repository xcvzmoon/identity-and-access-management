<script setup lang="ts">
  import * as valibot from 'valibot';

  const nameSchema = valibot.pipe(valibot.string(), valibot.nonEmpty());
  const detailsSchema = valibot.object({
    name: nameSchema,
    organization: valibot.nullable(nameSchema),
    role: valibot.nullable(nameSchema),
    permissions: valibot.array(valibot.string()),
    reference: nameSchema,
  });

  definePageMeta({ key: (route) => route.fullPath });

  const { error, pending, submit } = useAccountAction();
  const details = shallowRef<valibot.InferOutput<typeof detailsSchema> | null>(null);
  const loading = ref<boolean>(true);
  const query = useRequestURL().searchParams;
  const signedRequest = query.toString();
  const scopes = query.get('scope')?.split(/\s+/u).filter(Boolean) ?? [];

  async function decide(decision: 'allow' | 'deny'): Promise<void> {
    const grant = details.value;
    if (!grant) {
      return;
    }

    await submit(async () => {
      const response = await $fetch<unknown>('/api/v1/auth/oauth2/consent', {
        headers: { 'x-iam-consent-reference': grant.reference },
        method: 'POST',
        body: {
          accept: decision === 'allow',
          oauth_query: signedRequest,
        },
      });

      await followAuthorizationRedirect(valibot.parse(authorizationRedirectSchema, response));
    }, 'Unable to finish authorization. Reopen the application and try again.');
  }

  onMounted(async () => {
    await submit(async () => {
      const response = await $fetch<unknown>('/api/v1/app-consent/details', {
        method: 'POST',
        body: { oauth_query: signedRequest },
      });

      details.value = valibot.parse(detailsSchema, response);
    }, 'This authorization request is invalid or expired. Reopen the application to sign in.');

    loading.value = false;
  });
</script>

<template>
  <AccountPanel
    :title="details ? 'Allow ' + details.name + ' to sign you in?' : 'Confirm application access'"
  >
    <p
      v-if="loading"
      role="status"
    >
      Loading application details…
    </p>

    <div
      v-if="details"
      class="grid gap-4"
    >
      <dl
        v-if="(details.organization && details.role) || scopes.length || details.permissions.length"
        class="grid gap-4 border-y border-muted py-4 text-sm"
      >
        <div
          v-if="details.organization && details.role"
          class="grid gap-1"
        >
          <dt class="text-muted">Organization and role</dt>
          <dd class="flex flex-wrap items-center gap-2">
            <UAvatar
              icon="i-lucide-building-2"
              size="xs"
            />
            {{ details.organization }}
            <UBadge
              color="neutral"
              variant="subtle"
            >
              {{ details.role }}
            </UBadge>
          </dd>
        </div>
        <div
          v-if="scopes.length"
          class="grid gap-1"
        >
          <dt class="text-muted">Requested scopes</dt>
          <dd class="flex flex-wrap gap-1">
            <UBadge
              v-for="scope in scopes"
              :key="scope"
              color="neutral"
              variant="subtle"
            >
              {{ scope }}
            </UBadge>
          </dd>
        </div>
        <div
          v-if="details.permissions.length"
          class="grid gap-1"
        >
          <dt class="text-muted">App permissions</dt>
          <dd>
            <ul class="grid gap-1.5">
              <li
                v-for="permission in details.permissions"
                :key="permission"
                class="flex items-start gap-2 break-all"
              >
                <UIcon
                  name="i-lucide-key-round"
                  class="mt-0.5 shrink-0 text-muted"
                />
                {{ permission }}
              </li>
            </ul>
          </dd>
        </div>
      </dl>
      <div class="flex gap-3">
        <UButton
          :disabled="pending"
          label="Allow"
          @click="decide('allow')"
        />

        <UButton
          :disabled="pending"
          label="Deny"
          color="neutral"
          variant="outline"
          @click="decide('deny')"
        />
      </div>
    </div>

    <UAlert
      v-if="error"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :description="error"
    />
  </AccountPanel>
</template>
