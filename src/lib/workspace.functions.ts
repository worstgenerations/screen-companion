import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [p, c] = await Promise.all([
      supabase.from("projects").select("id, name, pinned, archived, updated_at").order("pinned", { ascending: false }).order("updated_at", { ascending: false }),
      supabase.from("conversations").select("id, title, project_id, favorite, archived, updated_at").order("updated_at", { ascending: false }).limit(200),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (c.error) throw new Error(c.error.message);
    return { projects: p.data, conversations: c.data };
  });

export const getMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("messages").select("id, role, content, source, created_at")
      .eq("conversation_id", data.id).order("created_at");
    if (error) throw new Error(error.message);
    return rows;
  });

export const createConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ projectId: z.string().uuid().nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("conversations").insert({ user_id: context.userId, project_id: data.projectId ?? null })
      .select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(120).optional(),
      favorite: z.boolean().optional(),
      archived: z.boolean().optional(),
      projectId: z.string().uuid().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, projectId, ...rest } = data;
    const patch = { ...rest, ...(projectId !== undefined ? { project_id: projectId } : {}) };
    const { error } = await context.supabase.from("conversations").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("conversations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1).max(80).optional(),
      pinned: z.boolean().optional(),
      archived: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    if (!id) {
      const { data: row, error } = await context.supabase
        .from("projects").insert({ user_id: context.userId, name: rest.name ?? "New project" })
        .select("id").single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { error } = await context.supabase.from("projects").update({ ...rest, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(error.message);
    return { id };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
