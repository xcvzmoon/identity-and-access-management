<script setup lang="ts">
  import { Field, Form, setInput, useForm } from '@formisch/vue';
  import * as valibot from 'valibot';

  const maximumPasswordLength = 128;
  const minimumPasswordLength = 12;
  const formSchema = valibot.object({
    name: valibot.pipe(valibot.string(), valibot.trim(), valibot.nonEmpty('Enter your name.')),
    email: valibot.pipe(
      valibot.string(),
      valibot.trim(),
      valibot.email('Enter a valid email address.'),
    ),
    password: valibot.pipe(
      valibot.string(),
      valibot.minLength(minimumPasswordLength, 'Enter at least 12 characters.'),
      valibot.maxLength(maximumPasswordLength),
    ),
  });
  type FormInput = valibot.InferOutput<typeof formSchema>;

  definePageMeta({ auth: 'guest' });

  const app = useNuxtApp();
  const error = shallowRef<string | null>(null);
  const form = useForm({
    schema: formSchema,
    initialInput: {
      name: '',
      email: '',
      password: '',
    },
  });

  async function submit(input: FormInput): Promise<void> {
    try {
      error.value = null;
      const result = await app.$auth.signUp.email(input);
      if (result.error) {
        error.value = result.error.message ?? 'Authentication failed.';
        return;
      }
      await app.$refreshAuthSession();
      await navigateTo('/account');
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
      <h1 class="text-3xl font-semibold tracking-tight">Sign up</h1>
    </header>

    <Form
      :of="form"
      class="space-y-5"
      @submit="submit"
    >
      <Field
        v-slot="field"
        :of="form"
        :path="['name']"
      >
        <FormInput
          v-model="field.input"
          :field-props="field.props"
          :errors="field.errors"
          label="Name"
          type="text"
          autocomplete="name"
        />
      </Field>

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
          autocomplete="new-password"
          description="Use 12 to 128 characters."
        />
      </Field>

      <UAlert
        v-if="error"
        :description="error"
        color="error"
        role="alert"
        title="Sign up failed"
      />

      <UButton
        :loading="form.isSubmitting"
        label="Sign up"
        type="submit"
        block
      />
    </Form>

    <p class="text-sm text-muted">
      Already registered?
      <NuxtLink
        to="/signin"
        class="text-primary underline underline-offset-4"
      >
        Sign in
      </NuxtLink>
    </p>
  </main>
</template>
