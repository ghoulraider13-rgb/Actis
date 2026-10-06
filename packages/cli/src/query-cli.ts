// CLI-specific query implementation that uses the actual database
import { getActiveProjects, queryEvents, getProjectByPath } from '@actis/core';
import { parseNaturalQuery, formatEventsForDisplay, ParsedQuery } from '@actis/core';
import type { FileEvent, Project } from '@actis/core';

export async function executeQuery(
  parsed: ParsedQuery,
  projectRoot?: string
): Promise<{ events: FileEvent[]; total: number; project: Project | undefined }> {
  let project: Project | undefined;

  if (projectRoot) {
    const proj = await getProjectByPath(projectRoot);
    if (proj) project = proj;
  }

  if (!project) {
    // Default to first active project
    const projects = await getActiveProjects();
    project = projects[0];
  }

  if (!project) {
    return { events: [], total: 0, project: undefined };
  }

  const result = await queryEvents(project.id!, {
    since: parsed.since,
    until: parsed.until,
    path: parsed.path,
    eventType: parsed.eventType,
    limit: parsed.limit || 100,
  });

  return { ...result, project };
}

export { parseNaturalQuery, formatEventsForDisplay, type ParsedQuery };