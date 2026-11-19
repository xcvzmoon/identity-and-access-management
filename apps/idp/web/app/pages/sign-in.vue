<script setup lang="ts">
  import { Field, Form, reset, useForm } from '@formisch/vue';
  import * as valibot from 'valibot';

  definePageMeta({ alias: '/' });

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

  async function signIn(values: valibot.InferOutput<typeof schema>): Promise<void> {
    await submit(async () => {
      const query = new URLSearchParams(globalThis.location.search);
      const authorization = query.has('sig') || query.has('client_id');
      const response = await $fetch<unknown>('/api/v1/auth/sign-in/email', {
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
  <AccountPanel title="Sign in">
    <p
      v-if="signedIn"
      role="status"
    >
      You are signed in. Open your invitation to join your organization.
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
          <input
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
          Password
          <input
            v-model="field.input"
            v-bind="field.props"
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
        Sign in
      </UButton>
      <NuxtLink to="/forgot-password">Forgot password?</NuxtLink>
      <NuxtLink to="/verify-email">Resend verification email</NuxtLink>
    </Form>
  </AccountPanel>
</template>
