<script setup lang="ts">
  import { Field, Form, reset, useForm } from '@formisch/vue';
  import * as valibot from 'valibot';

  const mode = ref<'bootstrap' | 'recover'>('bootstrap');
  const result = ref('');
  const { pending, error, submit } = useAccountAction();
  const required = valibot.pipe(valibot.string(), valibot.trim(), valibot.nonEmpty());
  const schema = valibot.object({
    email: valibot.pipe(required, valibot.email()),
    target: required,
    reference: required,
  });
  const form = useForm({ schema });
  const verified = ref(false);

  function switchMode(): void {
    mode.value = mode.value === 'bootstrap' ? 'recover' : 'bootstrap';
    result.value = '';
    error.value = '';
    verified.value = false;
    reset(form);
  }

  async function invite(values: valibot.InferOutput<typeof schema>): Promise<void> {
    result.value = '';

    await submit(async () => {
      const body =
        mode.value === 'bootstrap'
          ? {
              operation: mode.value,
              name: values.target,
              slug: values.reference,
              ownerEmail: values.email,
            }
          : {
              operation: mode.value,
              organizationId: values.target,
              caseReference: values.reference,
              ownerEmail: values.email,
              verifiedOwnerLockout: verified.value,
            };
      const response = await $fetch<{ organizationId: string }>(
        '/api/v1/operator/owner-invitations',
        {
          method: 'POST',
          body,
        },
      );
      result.value = `Owner invitation queued for organization ${response.organizationId}.`;
    }, 'Invitation failed. Check the organization details, operator access, and passkey verification.');
  }
</script>

<template>
  <AccountPanel title="Organization ownership">
    <NuxtLink to="/passkeys">Verify with a passkey</NuxtLink>
    <Form
      :of="form"
      @submit="invite"
    >
      <fieldset :disabled="pending">
        <legend>
          {{ mode === 'bootstrap' ? 'Invite a first owner' : 'Recover organization ownership' }}
        </legend>
        <button
          type="button"
          @click="switchMode"
        >
          {{ mode === 'bootstrap' ? 'Open recovery' : 'Open onboarding' }}
        </button>
        <Field
          :of="form"
          :path="['target']"
          v-slot="field"
        >
          <label>
            {{ mode === 'bootstrap' ? 'Organization name' : 'Organization ID' }}
            <input
              v-model="field.input"
              v-bind="field.props"
              required
            />
          </label>
        </Field>
        <Field
          :of="form"
          :path="['reference']"
          v-slot="field"
        >
          <label>
            {{ mode === 'bootstrap' ? 'Organization slug' : 'Verified case reference' }}
            <input
              v-model="field.input"
              v-bind="field.props"
              required
            />
          </label>
        </Field>
        <Field
          :of="form"
          :path="['email']"
          v-slot="field"
        >
          <label>
            Owner email address
            <input
              v-model="field.input"
              v-bind="field.props"
              type="email"
              required
            />
          </label>
        </Field>
        <label v-if="mode === 'recover'">
          <input
            v-model="verified"
            type="checkbox"
            required
          />
          I verified all owners are locked out and confirmed the replacement contact independently.
        </label>
        <UButton
          type="submit"
          :loading="pending"
        >
          Send owner invitation
        </UButton>
      </fieldset>
    </Form>
    <p
      v-if="result"
      role="status"
    >
      {{ result }}
    </p>
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
  </AccountPanel>
</template>
