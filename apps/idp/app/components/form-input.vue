<script setup lang="ts">
  import type { FieldElementProps } from '@formisch/vue';

  type Props = {
    fieldProps: FieldElementProps;
    errors: [string, ...string[]] | null;
    label: string;
    type?: 'text' | 'email' | 'password';
    autocomplete: string;
    description?: string;
  };

  const props = defineProps<Props>();
  const model = defineModel<string | undefined>({ required: true });

  const input = useTemplateRef<{ inputRef: HTMLInputElement | undefined }>('input');

  watchPostEffect((onCleanup) => {
    props.fieldProps.ref(input.value?.inputRef ?? null);
    onCleanup(() => props.fieldProps.ref(null));
  });
</script>

<template>
  <UFormField
    :name="props.fieldProps.name"
    :label="props.label"
    :description="props.description"
    :error="props.errors?.[0]"
    required
  >
    <UInput
      ref="input"
      v-model="model"
      :name="props.fieldProps.name"
      :type="props.type"
      :autocomplete="props.autocomplete"
      :autofocus="props.fieldProps.autofocus"
      class="w-full"
      @focus="props.fieldProps.onFocus"
      @change="props.fieldProps.onChange"
      @blur="props.fieldProps.onBlur"
    />
  </UFormField>
</template>
