<script setup lang="ts">
  import { Field, Form, reset, useForm } from '@formisch/vue';
  import * as valibot from 'valibot';

  definePageMeta({ alias: '/' });

  const formReady = ref(false);
  const signedIn = ref(false);
  const { error, pending, submit } = useAccountAction();
  const schema = valibot.object({
    email: valibot.pipe(
      valibot.string(),
      valibot.trim(),
      valibot.email('Enter a valid email address.'),
    ),
    password: valibot.pipe(valibot.string(), valibot.nonEmpty('Enter your password.')),
  });
  const form = useForm({
    schema,
    initialInput: {
      email: '',
      password: '',
    },
  });

  onMounted(() => {
    formReady.value = true;
  });

  async function signIn(values: valibot.InferOutput<typeof schema>): Promise<void> {
    await submit(async () => {
      const query = new URLSearchParams(globalThis.location.search);
      const authorization = query.has('sig') || query.has('client_id');
      const response = await $fetch<unknown>('/api/v1/web/sign-in/email', {
        method: 'POST',
        body: {
          email: values.email,
          password: values.password,
          ...(authorization && { oauth_query: query.toString() }),
        },
      });

      reset(form);

      if (authorization) {
        await followAuthorizationRedirect(valibot.parse(authorizationRedirectSchema, response));
        return;
      }

      signedIn.value = true;
    }, 'Unable to sign in. Check your credentials and verify your email.');
  }
</script>

<template>
  <AccountPanel
    title="Sign in"
    description="Use the email address associated with your IAM account."
  >
    <p
      v-if="signedIn"
      role="status"
    >
      You are signed in. Open your invitation to join your organization.
      <NuxtLink to="/sign-out">Sign out of IAM</NuxtLink>
    </p>
    <Form
      :of="form"
      v-else
      @submit="signIn"
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
            :disabled="!formReady"
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
          Password
          <UInput
            class="w-full"
            size="lg"
            v-model="field.input"
            v-bind="field.props"
            :disabled="!formReady"
            type="password"
            autocomplete="current-password"
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
        block
        size="lg"
        :disabled="!formReady"
        :loading="pending"
      >
        Sign in
      </UButton>
      <div class="flex flex-wrap justify-center gap-x-4 gap-y-1">
        <NuxtLink to="/forgot-password">Forgot password?</NuxtLink>
        <NuxtLink to="/verify-email">Resend verification email</NuxtLink>
      </div>
      <p class="border-t border-muted pt-4 text-center text-xs text-pretty text-muted">
        IAM counts password sign-ins and keeps the account, time, and sign-in route for security
        investigations for 30 days.
      </p>
    </Form>
  </AccountPanel>
</template>
