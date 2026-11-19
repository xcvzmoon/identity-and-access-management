<script setup lang="ts">
  import { Form, useForm } from '@formisch/vue';
  import * as valibot from 'valibot';

  type Props = { scope: 'app' | 'iam' };

  const props = defineProps<Props>();
  const schema = valibot.object({ scope: valibot.picklist(['app', 'iam']) });
  const form = useForm({
    schema,
    initialInput: { scope: props.scope },
  });

  function signOut(_values: valibot.InferOutput<typeof schema>, event?: Event): void {
    if (event?.target instanceof HTMLFormElement) {
      event.target.submit();
    }
  }
</script>

<template>
  <Form
    :of="form"
    action="/api/v1/sign-out"
    method="post"
    @submit="signOut"
  >
    <input
      type="hidden"
      name="scope"
      :value="scope"
    />
    <UButton
      type="submit"
      color="neutral"
      variant="outline"
    >
      {{ scope === 'app' ? 'Sign out of console' : 'Sign out of IAM' }}
    </UButton>
  </Form>
</template>
