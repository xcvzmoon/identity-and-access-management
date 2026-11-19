<script setup lang="ts">
  import { number, object, optional, safeParse } from 'valibot';

  type Action = 'request' | 'reset';
  type Step = 'request' | 'reset' | 'done';

  const endpoint = '/api/auth/account/password-recovery';
  const passwordMinLength = 12;
  const passwordMaxLength = 128;
  const maxEmailLength = 254;
  const codeLength = 8;
  const tooManyRequests = 429;
  const unavailable = 503;
  const errorSchema = object({ statusCode: optional(number()) });

  useHead({ title: 'Set or reset your password' });

  const userSession = useUserSession();
  const webApi = useWebApi();
  const step = shallowRef<Step>('request');
  const email = shallowRef<string>('');
  const code = shallowRef<string>('');
  const password = shallowRef<string>('');
  const confirmation = shallowRef<string>('');
  const pending = shallowRef<Action | null>(null);
  const error = shallowRef<string | null>(null);

  async function recover(action: Action): Promise<void> {
    if (pending.value) {
      return;
    }

    error.value = null;

    if (action === 'reset' && password.value !== confirmation.value) {
      error.value = 'The passwords do not match.';
      return;
    }

    pending.value = action;

    try {
      const body =
        action === 'request'
          ? {
              action,
              email: email.value,
            }
          : {
              action,
              email: email.value,
              code: code.value,
              password: password.value,
            };
      await webApi(endpoint, {
        method: 'POST',
        retry: 0,
        body,
      });

      if (action === 'reset') {
        userSession.clear();
      }

      step.value = action === 'request' ? 'reset' : 'done';
    } catch (error_) {
      const parsed = safeParse(errorSchema, error_);
      const status = parsed.success ? parsed.output.statusCode : null;
      if (status === tooManyRequests) {
        error.value = 'Too many attempts. Try again in a minute.';
      } else if (status === unavailable) {
        error.value = 'Password recovery is unavailable. Try again later.';
      } else {
        error.value =
          action === 'reset'
            ? 'Enter a valid code and a password that meets the requirements.'
            : 'Could not request a code. Check the email address and try again.';
      }
    } finally {
      pending.value = null;

      if (action === 'reset') {
        password.value = '';
        confirmation.value = '';
        code.value = '';
      }
    }
  }

  function changeEmail(): void {
    step.value = 'request';
    code.value = '';
    password.value = '';
    confirmation.value = '';
    error.value = null;
  }
</script>

<template>
  <main class="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 px-6 py-12">
    <header>
      <h1 class="text-3xl font-semibold tracking-tight">Set or reset your password</h1>
      <p class="mt-2 text-sm text-muted">
        Use the code sent to your email to verify ownership and choose a password.
      </p>
    </header>

    <UAlert
      v-if="error"
      :description="error"
      color="error"
      role="alert"
    />

    <form
      v-if="step === 'request'"
      class="space-y-4"
      @submit.prevent="recover('request')"
    >
      <UFormField label="Account email">
        <UInput
          v-model="email"
          :maxlength="maxEmailLength"
          :disabled="pending !== null"
          type="email"
          autocomplete="email"
          class="w-full"
          required
        />
      </UFormField>

      <UButton
        :loading="pending === 'request'"
        label="Send email code"
        type="submit"
        block
      />
    </form>

    <form
      v-else-if="step === 'reset'"
      class="space-y-4"
      @submit.prevent="recover('reset')"
    >
      <p
        class="text-sm text-muted"
        role="status"
      >
        If this email is eligible, a code will arrive shortly. It expires in five minutes.
      </p>

      <UFormField label="Account email">
        <UInput
          v-model="email"
          type="email"
          autocomplete="email"
          class="w-full"
          readonly
        />
      </UFormField>

      <UFormField label="Email code">
        <UInput
          v-model="code"
          :maxlength="codeLength"
          :disabled="pending !== null"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]{8}"
          class="w-full"
          required
        />
      </UFormField>

      <UFormField
        label="New password"
        description="Use 12 to 128 characters."
      >
        <UInput
          v-model="password"
          :minlength="passwordMinLength"
          :maxlength="passwordMaxLength"
          :disabled="pending !== null"
          type="password"
          autocomplete="new-password"
          class="w-full"
          required
        />
      </UFormField>

      <UFormField label="Confirm new password">
        <UInput
          v-model="confirmation"
          :minlength="passwordMinLength"
          :maxlength="passwordMaxLength"
          :disabled="pending !== null"
          type="password"
          autocomplete="new-password"
          class="w-full"
          required
        />
      </UFormField>

      <UButton
        :loading="pending === 'reset'"
        :disabled="pending !== null"
        label="Save password"
        type="submit"
        block
      />

      <div class="flex flex-wrap gap-2">
        <UButton
          :loading="pending === 'request'"
          :disabled="pending !== null"
          label="Send another code"
          variant="ghost"
          @click="recover('request')"
        />

        <UButton
          :disabled="pending !== null"
          label="Use a different email"
          variant="ghost"
          @click="changeEmail"
        />
      </div>
    </form>

    <p
      v-else
      class="text-sm text-muted"
      role="status"
    >
      Your password was saved. Sign in with your new password.
    </p>

    <NuxtLink
      to="/signin"
      class="text-sm text-primary underline underline-offset-4"
    >
      Back to sign in
    </NuxtLink>
  </main>
</template>
