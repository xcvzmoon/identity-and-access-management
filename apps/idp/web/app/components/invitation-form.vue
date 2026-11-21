<script setup lang="ts">
  import { Field, Form, reset, useForm } from '@formisch/vue';
  import * as valibot from 'valibot';

  type Props = {
    token: string;
    verified: boolean;
  };

  const props = defineProps<Props>();
  const requests = new AbortController();

  onBeforeUnmount(() => requests.abort());

  const mode = ref<'new' | 'existing'>(props.verified ? 'existing' : 'new');
  const message = ref('');
  const { error, pending, submit } = useAccountAction();

  const MIN_PASSWORD_LENGTH = 15;
  const MAX_PASSWORD_LENGTH = 128;
  const MAX_NAME_LENGTH = 128;

  const schema = valibot.object({
    email: valibot.pipe(
      valibot.string(),
      valibot.trim(),
      valibot.email('Enter a valid email address.'),
    ),
    password: valibot.pipe(
      valibot.string(),
      valibot.nonEmpty('Enter your password.'),
      valibot.check(
        (value) =>
          mode.value === 'existing' ||
          (value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH),
        'Use 15 to 128 characters.',
      ),
    ),
    name: valibot.pipe(
      valibot.string(),
      valibot.trim(),
      valibot.check(
        (value) => mode.value === 'existing' || (Boolean(value) && value.length <= MAX_NAME_LENGTH),
        'Enter a name up to 128 characters.',
      ),
    ),
  });
  const form = useForm({
    schema,
    initialInput: {
      email: '',
      password: '',
      name: '',
    },
  });

  async function join(values: valibot.InferOutput<typeof schema>): Promise<void> {
    await submit(async () => {
      if (mode.value === 'new') {
        await $fetch('/api/v1/invitations/signup', {
          method: 'POST',
          signal: requests.signal,
          body: {
            token: props.token,
            email: values.email,
            password: values.password,
            name: values.name,
          },
        });

        reset(form);

        message.value =
          'Check your inbox to verify your email, then return to this invitation and choose “Use an existing account”.';

        return;
      }

      await $fetch('/api/v1/web/sign-in/email', {
        method: 'POST',
        signal: requests.signal,
        body: {
          email: values.email,
          password: values.password,
        },
      });

      reset(form);

      await $fetch('/api/v1/invitations/accept', {
        method: 'POST',
        signal: requests.signal,
        body: { token: props.token },
      });

      message.value = 'You have joined the organization.';
    }, 'Unable to use this invitation. Check the invitation, email address, and credentials.');
  }
</script>

<template>
  <AccountPanel title="Join your organization">
    <UAlert
      v-if="message"
      role="status"
      color="success"
      variant="subtle"
      icon="i-lucide-circle-check"
      :description="message"
    />
    <Form
      :of="form"
      v-else
      @submit="join"
    >
      <URadioGroup
        v-model="mode"
        legend="Account"
        :disabled="pending"
        :items="[
          { label: 'Create an account', value: 'new' },
          { label: 'Use an existing account', value: 'existing' },
        ]"
      />
      <Field
        v-if="mode === 'new'"
        :of="form"
        :path="['name']"
        v-slot="field"
      >
        <label>
          Name
          <UInput
            class="w-full"
            size="lg"
            v-model="field.input"
            v-bind="field.props"
            autocomplete="name"
            maxlength="128"
            required
          />
          <span
            v-if="field.errors"
            role="alert"
          >
            {{ field.errors[0] }}
          </span>
        </label>
      </Field>
      <Field
        :of="form"
        :path="['email']"
        v-slot="field"
      >
        <label>
          Invited email address
          <UInput
            class="w-full"
            size="lg"
            v-model="field.input"
            v-bind="field.props"
            type="email"
            autocomplete="username"
            required
          />
          <span
            v-if="field.errors"
            role="alert"
          >
            {{ field.errors[0] }}
          </span>
        </label>
      </Field>
      <Field
        :of="form"
        :path="['password']"
        v-slot="field"
      >
        <label>
          {{ mode === 'new' ? 'Password (15–128 characters)' : 'Password' }}
          <UInput
            class="w-full"
            size="lg"
            v-model="field.input"
            v-bind="field.props"
            type="password"
            :minlength="mode === 'new' ? 15 : undefined"
            maxlength="128"
            :autocomplete="mode === 'new' ? 'new-password' : 'current-password'"
            required
          />
          <span
            v-if="field.errors"
            role="alert"
          >
            {{ field.errors[0] }}
          </span>
        </label>
      </Field>
      <UAlert
        v-if="error"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :description="error"
      />
      <UButton
        type="submit"
        :loading="pending"
      >
        {{ mode === 'new' ? 'Create account' : 'Sign in and accept' }}
      </UButton>
      <p class="border-t border-muted pt-4 text-xs text-muted">
        IAM counts password sign-ins and keeps the account, time, and sign-in route for security
        investigations for 30 days.
      </p>
    </Form>
  </AccountPanel>
</template>
