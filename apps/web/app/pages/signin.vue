<script setup lang="ts">
  import { Field, Form, setInput, useForm } from '@formisch/vue';
  import * as valibot from 'valibot';

  const maximumPasswordLength = 128;
  const formSchema = valibot.object({
    email: valibot.pipe(
      valibot.string(),
      valibot.trim(),
      valibot.email('Enter a valid email address.'),
    ),
    password: valibot.pipe(
      valibot.string(),
      valibot.nonEmpty('Enter your password.'),
      valibot.maxLength(maximumPasswordLength),
    ),
  });
  type FormInput = valibot.InferOutput<typeof formSchema>;

  definePageMeta({ auth: 'guest' });

  const route = useRoute();
  const session = useUserSession();
  const form = useForm({
    schema: formSchema,
    initialInput: {
      email: '',
      password: '',
    },
  });
  const error = shallowRef<string | null>(null);

  async function submit(input: FormInput): Promise<void> {
    try {
      error.value = null;
      await $fetch('/api/signin', {
        method: 'POST',
        body: input,
      });
      await session.refresh();

      if (!session.loggedIn.value) {
        error.value = 'Could not load your session.';
        return;
      }

      await navigateTo(route.query.redirect === '/admin' ? '/admin' : '/account');
    } catch {
      error.value = 'Authentication failed.';
    } finally {
      setInput(form, {
        path: ['password'],
        input: '',
      });
    }
  }
</script>

<template>
  <main class="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
    <header>
      <p class="mb-3 text-xs tracking-widest text-muted uppercase">Identity and access</p>
      <h1 class="text-3xl font-semibold tracking-tight">Sign in</h1>
    </header>

    <Form
      :of="form"
      class="space-y-5"
      @submit="submit"
    >
      <Field
        v-slot="field"
        :of="form"
        :path="['email']"
      >
        <FormInput
          v-model="field.input"
          :field-props="field.props"
          :errors="field.errors"
          label="Email"
          type="email"
          autocomplete="email"
        />
      </Field>

      <Field
        v-slot="field"
        :of="form"
        :path="['password']"
      >
        <FormInput
          v-model="field.input"
          :field-props="field.props"
          :errors="field.errors"
          label="Password"
          type="password"
          autocomplete="current-password"
        />
      </Field>

      <UAlert
        v-if="error"
        :description="error"
        color="error"
        role="alert"
        title="Sign in failed"
      />

      <UButton
        :loading="form.isSubmitting"
        label="Sign in"
        type="submit"
        block
      />
    </Form>

    <NuxtLink
      to="/recover-password"
      class="text-sm text-primary underline underline-offset-4"
    >
      Verify your email or reset your password
    </NuxtLink>

    <p class="text-sm text-muted">
      Need an account?
      <NuxtLink
        to="/signup"
        class="text-primary underline underline-offset-4"
      >
        Sign up
      </NuxtLink>
    </p>
  </main>
</template>
