<script setup lang="ts">
  import type { ManagementActionName, OrganizationDetails } from '~/utils/management';
  import { Field, Form, reset, useForm } from '@formisch/vue';
  import * as valibot from 'valibot';
  import { operations } from '~/utils/management';

  type InputName =
    | 'name'
    | 'email'
    | 'role'
    | 'redirectUri'
    | 'clientId'
    | 'permissions'
    | 'userId';
  type Choice = { label: string; value: string };

  type Props = {
    action: ManagementActionName;
    clientId?: string;
    actorId: string;
    actorRole: string;
    organizationId: string;
    details: OrganizationDetails;
  };
  type Command = {
    organizationId: string;
    action: ManagementActionName;
    permissions?: string[];
  } & Partial<Record<Exclude<InputName, 'permissions'>, string>>;

  const props = defineProps<Props>();
  const emit = defineEmits<{ saved: [action: ManagementActionName] }>();
  const fields: Record<ManagementActionName, InputName[]> = {
    rename: ['name'],
    invite: ['email', 'role'],
    register: ['name', 'redirectUri'],
    defineRole: ['clientId', 'role', 'permissions'],
    assign: ['clientId', 'userId', 'role'],
    revoke: ['clientId', 'userId'],
    removeMember: ['userId'],
    disableInstallation: ['clientId'],
  };
  const labels: Record<InputName, string> = {
    name: 'Name',
    email: 'Email address',
    role: 'Role',
    redirectUri: 'HTTPS callback URL',
    clientId: 'App installation',
    permissions: 'Permissions (comma-separated)',
    userId: 'Member',
  };
  const inputs = fields[props.action];
  const text = valibot.pipe(valibot.string(), valibot.trim());
  const schema = valibot.object({
    name: text,
    role: text,
    permissions: text,
    clientId: text,
    userId: text,
    email:
      props.action === 'invite'
        ? valibot.pipe(text, valibot.email('Enter a valid email address.'))
        : text,
    redirectUri:
      props.action === 'register'
        ? valibot.pipe(
            text,
            valibot.url('Enter a valid URL.'),
            valibot.startsWith('https://', 'Use HTTPS.'),
          )
        : text,
  });
  const form = useForm({
    schema,
    initialInput: {
      name: '',
      email: '',
      role: '',
      permissions: '',
      clientId: props.clientId ?? '',
      userId: '',
      redirectUri: '',
    },
  });
  const selectedClient = ref(props.clientId ?? '');
  const message = ref('');
  const error = ref('');
  const credentials = ref<{ clientId: string; clientSecret: string } | null>(null);
  const pending = ref(false);

  function choices(field: InputName): Choice[] | null {
    if (field === 'clientId') {
      return props.details.installations.map(({ name, clientId }) => ({
        label: name,
        value: clientId,
      }));
    }

    if (field === 'userId') {
      const assigned = new Set(
        props.details.assignments
          .filter(({ clientId }) => clientId === props.clientId)
          .map(({ userId }) => userId),
      );
      return props.details.members.flatMap(({ email, userId, role }) => {
        if (props.clientId && props.action === 'revoke' && !assigned.has(userId)) {
          return [];
        }

        if (
          props.action === 'removeMember' &&
          (userId === props.actorId || (role !== 'member' && props.actorRole !== 'owner'))
        ) {
          return [];
        }

        return [
          {
            label: email,
            value: userId,
          },
        ];
      });
    }

    if (field === 'role' && props.action === 'invite') {
      const roles = props.actorRole === 'owner' ? ['member', 'admin'] : ['member'];
      return roles.map((role) => ({
        label: role,
        value: role,
      }));
    }

    if (field === 'role' && props.action === 'assign') {
      const installation = props.details.installations.find(
        ({ clientId }) => clientId === selectedClient.value,
      );

      return Object.keys(installation?.rolePermissions ?? {}).map((role) => ({
        label: role,
        value: role,
      }));
    }

    return null;
  }

  async function save(values: valibot.InferOutput<typeof schema>): Promise<void> {
    if (pending.value) {
      return;
    }

    pending.value = true;
    error.value = '';
    credentials.value = null;
    message.value = '';

    try {
      const body: Command = {
        organizationId: props.organizationId,
        action: props.action,
      };

      for (const input of inputs) {
        if (input === 'permissions') {
          body.permissions = values.permissions
            .split(',')
            .map((permission) => permission.trim())
            .filter(Boolean);
        } else {
          body[input] = values[input];
        }
      }

      const result = await $fetch('/api/v1/management', {
        method: 'POST',
        body,
      });

      if (props.action === 'register') {
        credentials.value = valibot.parse(
          valibot.object({
            clientId: valibot.string(),
            clientSecret: valibot.string(),
          }),
          result,
        );
      }

      message.value = 'Changes saved.';
      reset(form);
      selectedClient.value = props.clientId ?? '';
      emit('saved', props.action);
    } catch {
      error.value =
        'The change could not be completed. Check the values and your permissions, then verify with a passkey before trying again.';
    } finally {
      pending.value = false;
    }
  }
</script>

<template>
  <Form
    :of="form"
    class="grid gap-4"
    @submit="save"
  >
    <Field
      v-for="input in inputs"
      :key="input"
      :of="form"
      :path="[input]"
      v-slot="field"
    >
      <label class="grid gap-1">
        {{ labels[input] }}
        <UInput
          v-if="input === 'clientId' && clientId"
          v-model="field.input"
          v-bind="field.props"
          readonly
        />
        <USelect
          v-else-if="choices(input)"
          v-model="field.input"
          v-bind="field.props"
          :items="choices(input) ?? []"
          placeholder="Select an option"
          required
          @update:model-value="
            (value) => {
              if (input === 'clientId') {
                selectedClient = value ?? '';
              }
            }
          "
        />
        <UInput
          v-else
          v-model="field.input"
          v-bind="field.props"
          :type="input === 'email' ? 'email' : input === 'redirectUri' ? 'url' : 'text'"
          required
          class="w-full"
        />
        <span
          v-if="field.errors"
          role="alert"
        >
          {{ field.errors[0] }}
        </span>
      </label>
    </Field>
    <UButton
      type="submit"
      :loading="pending"
      class="justify-self-start"
    >
      {{ operations[action] }}
    </UButton>
    <UAlert
      v-if="message"
      role="status"
      color="success"
      variant="subtle"
      icon="i-lucide-circle-check"
      :description="message"
    />
    <UAlert
      v-if="error"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :description="error"
    />
    <section
      v-if="credentials"
      class="grid gap-2 rounded border border-default p-3"
    >
      <h3 class="font-semibold">App credentials</h3>
      <p>Save the client secret before leaving this form.</p>
      <dl>
        <dt>Client ID</dt>
        <dd class="break-all font-mono">{{ credentials.clientId }}</dd>
        <dt>Client secret</dt>
        <dd class="break-all font-mono">{{ credentials.clientSecret }}</dd>
      </dl>
      <UButton
        type="button"
        variant="outline"
        @click="credentials = null"
      >
        Hide credentials
      </UButton>
    </section>
  </Form>
</template>
