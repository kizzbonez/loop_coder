import { asc, count, eq, inArray } from 'drizzle-orm';
import type { AgentRoleDTO, AgentRoleInput } from '@loop/shared';
import { agentRoleSchema, updateAgentRoleSchema } from '@loop/shared';
import { db, type Executor } from '../../db/client';
import { agentRoles, boardColumns, type AgentRoleRow } from '../../db/schema';
import type { Actor } from '../../lib/actor';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { now } from '../../lib/time';
import { audit } from '../audit/audit.service';
import { DEFAULT_ROLES } from './default-roles';
import type { z } from 'zod';

export function toRoleDTO(r: AgentRoleRow): AgentRoleDTO {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    instructions: r.instructions,
    color: r.color,
    isSystem: r.isSystem,
    enabled: r.enabled,
    assignable: r.assignable,
  };
}

export function listRoles(exec: Executor = db): AgentRoleRow[] {
  return exec.select().from(agentRoles).orderBy(asc(agentRoles.createdAt), asc(agentRoles.key)).all();
}

export function getRoleById(id: string, exec: Executor = db): AgentRoleRow | undefined {
  return exec.select().from(agentRoles).where(eq(agentRoles.id, id)).get();
}

export function getRoleByKey(key: string, exec: Executor = db): AgentRoleRow | undefined {
  return exec.select().from(agentRoles).where(eq(agentRoles.key, key)).get();
}

export function rolesByIds(ids: string[], exec: Executor = db): Map<string, AgentRoleRow> {
  if (ids.length === 0) return new Map();
  return new Map(
    exec
      .select()
      .from(agentRoles)
      .where(inArray(agentRoles.id, [...new Set(ids)]))
      .all()
      .map((r) => [r.id, r]),
  );
}

/** Insert built-in roles that do not exist yet. Existing (possibly edited) roles are left untouched. */
export function seedDefaultRoles(): void {
  const existing = new Set(listRoles().map((r) => r.key));
  for (const role of DEFAULT_ROLES) {
    if (existing.has(role.key)) continue;
    db.insert(agentRoles)
      .values({ ...role, isSystem: true, enabled: true })
      .run();
  }
}

export function createRole(actor: Actor, input: AgentRoleInput): AgentRoleRow {
  const data = agentRoleSchema.parse(input);
  if (getRoleByKey(data.key)) throw conflict(`A role with key "${data.key}" already exists`);
  const row = db
    .insert(agentRoles)
    .values({ ...data, isSystem: false })
    .returning()
    .get();
  audit({ action: 'role.created', actor, targetType: 'agent_role', targetId: row.id, metadata: { key: row.key } });
  return row;
}

export function updateRole(actor: Actor, id: string, input: z.input<typeof updateAgentRoleSchema>): AgentRoleRow {
  const data = updateAgentRoleSchema.parse(input);
  const role = getRoleById(id);
  if (!role) throw notFound('Role');
  const row = db
    .update(agentRoles)
    .set({ ...data, updatedAt: now() })
    .where(eq(agentRoles.id, id))
    .returning()
    .get();
  audit({ action: 'role.updated', actor, targetType: 'agent_role', targetId: id, metadata: { fields: Object.keys(data) } });
  return row!;
}

export function deleteRole(actor: Actor, id: string): void {
  const role = getRoleById(id);
  if (!role) throw notFound('Role');
  if (role.isSystem) throw badRequest('Built-in roles cannot be deleted. Disable the role instead.');
  const used = db.select({ n: count() }).from(boardColumns).where(eq(boardColumns.agentRoleId, id)).get();
  if ((used?.n ?? 0) > 0) throw conflict('This role is mapped to board columns. Remove the mapping first.');
  db.delete(agentRoles).where(eq(agentRoles.id, id)).run();
  audit({ action: 'role.deleted', actor, targetType: 'agent_role', targetId: id, metadata: { key: role.key } });
}
