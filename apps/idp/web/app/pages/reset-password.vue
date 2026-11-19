<script setup lang="ts">
  import { Field, Form, reset, useForm } from '@formisch/vue';
  import * as valibot from 'valibot';

  const route = useRoute();
  const token = computed(() => (Array.isArray(route.query.token) ? '' : (route.query.token ?? '')));
  const changed = ref(false);
  const { error, pending, submit } = useAccountAction();

  const MIN_PASSWORD_LENGTH = 15;
  const MAX_PASSWORD_LENGTH = 128;

  const schema = valibot.object({
    password: valibot.pipe(
      valibot.string(),
      valibot.minLength(MIN_PASSWORD_LENGTH, 'Use at least 15 characters.'),
      valibot.maxLength(MAX_PASSWORD_LENGTH, 'Use at most 128 characters.'),
    ),
  });
  const form = useForm({
    schema,
    initialInput: {
      password: '',
    },
  });

  async function resetPassword(values: valibot.InferOutput<typeof schema>): Promise<void> {
    await submit(async () => {
      await $fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        body: {
          token: token.value,
          newPassword: values.password,
        },
      });

      reset(form);

      changed.value = true;
    }, 'Unable to reset your password. Request a fresh link and try again.');
  }
</script>

<template>
  <AccountPanel title="Reset your password">
    <p
      v-if="changed"
      role="status"
    >
      Password updated. Sign in again with your new password.
    </p>
    <p
      v-else-if="!token"
      role="alert"
    >
      This reset link is invalid or expired.
      <NuxtLink to="/forgot-password">Request a new link</NuxtLink>
    </p>
    <Form
      :of="form"
      v-else
      @submit="resetPassword"
    >
      <Field
        :of="form"
        :path="['password']"
        v-slot="field"
      >
        <label>
          New password (15–128 characters)
          <input
            v-model="field.input"
            v-bind="field.props"
            type="password"
            autocomplete="new-password"
            minlength="15"
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
      <p
        v-if="error"
        role="alert"
      >
        {{ error }}
      </p>
      <UButton
        type="submit"
        :loading="pending"
      >
        Reset password
      </UButton>
    </Form>
    <NuxtLink to="/sign-in">Back to sign in</NuxtLink>
  </AccountPanel>
</template>
