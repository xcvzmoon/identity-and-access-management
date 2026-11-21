<script setup lang="ts">
  import { Field, Form, useForm } from '@formisch/vue';
  import * as valibot from 'valibot';

  type Props = { purpose: 'verify' | 'recover' };

  const props = defineProps<Props>();
  const sent = ref(false);
  const { error, pending, submit } = useAccountAction();
  const schema = valibot.object({
    email: valibot.pipe(
      valibot.string(),
      valibot.trim(),
      valibot.email('Enter a valid email address.'),
    ),
  });
  const form = useForm({
    schema,
    initialInput: {
      email: '',
    },
  });

  async function requestEmail(values: valibot.InferOutput<typeof schema>): Promise<void> {
    await submit(async () => {
      const origin = globalThis.location.origin;
      const recover = props.purpose === 'recover';
      const endpoint = recover
        ? '/api/v1/auth/request-password-reset'
        : '/api/v1/auth/send-verification-email';
      const callback = recover
        ? { redirectTo: new URL('/reset-password', origin).href }
        : { callbackURL: new URL('/sign-in', origin).href };

      await $fetch(endpoint, {
        method: 'POST',
        body: {
          email: values.email,
          ...callback,
        },
      });

      sent.value = true;
    }, 'Unable to submit your request. Please try again.');
  }
</script>

<template>
  <AccountPanel
    :description="
      sent
        ? undefined
        : purpose === 'recover'
          ? 'Enter your account email to request a password reset link.'
          : 'Enter your account email to request a new verification link.'
    "
    :title="purpose === 'recover' ? 'Recover your account' : 'Verify your email'"
  >
    <p
      v-if="sent"
      role="status"
    >
      If your account is eligible, you will receive an email with instructions.
    </p>
    <Form
      :of="form"
      v-else
      @submit="requestEmail"
    >
      <Field
        :of="form"
        :path="['email']"
        v-slot="field"
      >
        <label>
          Email address
          <UInput
            class="w-full"
            size="lg"
            v-model="field.input"
            v-bind="field.props"
            type="email"
            autocomplete="email"
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
        {{ purpose === 'recover' ? 'Send reset link' : 'Send verification link' }}
      </UButton>
    </Form>
    <NuxtLink to="/sign-in">Back to sign in</NuxtLink>
  </AccountPanel>
</template>
