import { db } from "db";
import {
  projects,
  type Project,
  type ProjectInsert,
  projectPublicFields,
} from "db/schema/project";
import { eq, and, desc, inArray, count, gt } from "drizzle-orm";
import { conflict, notFound } from "backend/errors";
import { cursorLimit } from "./cursor";
import { whereNotNull } from "db/utils";
import { apps } from "db/schema/app";
import { appDAO } from "./app";

export const projectDAO = {
  create: async (data: ProjectInsert) => {
    const [created] = await db
      .insert(projects)
      .values(data)
      .onConflictDoNothing()
      .returning(projectPublicFields);
    if (!created) throw conflict(`Project slug already exists: ${data.name}`);
    return created;
  },

  duplicate: async (
    sourceId: string,
    overrides: { name?: string; slug?: string; description?: string },
  ) => {
    const source = await projectDAO.findByIdOrThrow(sourceId);
    const name = overrides.name?.trim() || `${source.name} (copy)`;
    const project = await projectDAO.create({
      name,
      description: overrides.description ?? source.description,
    });

    const apps = await appDAO.listByProject(project.id);
    const duplicatedApps = await Promise.all(
      apps.map((app) =>
        appDAO.create({
          projectId: project.id,
          name: app.name,
          platform: app.platform,
          publicKey: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
        }),
      ),
    );
    return { project, apps: duplicatedApps };
  },

  findById: async (id: string): Promise<Project | undefined> =>
    (
      await db
        .select(projectPublicFields)
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1)
    )[0],

  findByIdOrThrow: async (id: string) => {
    const project = await projectDAO.findById(id);
    if (!project) throw notFound("Project", id);
    return project;
  },

  list: (
    page: {
      cursor?: string;
      limit?: number;
    },
    options: {
      projectIds?: string[];
    },
  ) =>
    db
      .select({ ...projectPublicFields, appCount: count(apps.id) })
      .from(projects)
      .where(
        and(
          whereNotNull(inArray, projects.id, options?.projectIds),
          whereNotNull(gt, projects.id, page?.cursor),
        ),
      )
      .orderBy(desc(projects.createdAt), desc(projects.id))
      .rightJoin(apps, eq(apps.projectId, projects.id))
      .limit(cursorLimit(page?.limit)),

  delete: (id: string) => db.delete(projects).where(eq(projects.id, id)),
};
