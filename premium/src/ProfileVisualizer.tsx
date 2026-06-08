// premium/src/ProfileVisualizer.tsx
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// A read-only visualization of the parsed candidate profile (resume + active
// JD) shown in the Profile Intelligence settings panel. Replaces the formerly
// proprietary component; renders entirely from the `profileData` IPC payload.

import React from 'react';

type SkillBuckets = Record<string, string[]>;

interface ProfileData {
  identity?: { name?: string; email?: string; location?: string; summary?: string };
  skills?: SkillBuckets | string[];
  skillsFlat?: string[];
  experience?: Array<{ company?: string; role?: string; start_date?: string | null; end_date?: string | null; bullets?: string[] }>;
  projects?: Array<{ name?: string; description?: string; technologies?: string[] }>;
  experienceCount?: number;
  projectCount?: number;
  educationCount?: number;
  nodeCount?: number;
  activeJD?: { title?: string; company?: string; technologies?: string[] } | null;
  hasActiveJD?: boolean;
}

const chip =
  'inline-block rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/80 mr-1.5 mb-1.5';
const section = 'mb-4';
const heading = 'text-xs font-semibold uppercase tracking-wide text-white/50 mb-1.5';

function flattenSkills(skills: ProfileData['skills'], flat?: string[]): string[] {
  if (Array.isArray(flat) && flat.length) return flat;
  if (Array.isArray(skills)) return skills.filter(Boolean) as string[];
  if (skills && typeof skills === 'object') {
    return Object.values(skills).flat().filter(Boolean) as string[];
  }
  return [];
}

export const ProfileVisualizer: React.FC<{ profileData?: ProfileData | null }> = ({ profileData }) => {
  if (!profileData) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/50">
        No profile loaded yet. Upload a resume to see your parsed profile here.
      </div>
    );
  }

  const { identity = {}, experience = [], projects = [], activeJD, hasActiveJD } = profileData;
  const skills = flattenSkills(profileData.skills, profileData.skillsFlat);

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-white/90">
      {/* Identity */}
      <div className={section}>
        <div className="text-base font-semibold">{identity.name || 'Your profile'}</div>
        {(identity.location || identity.email) && (
          <div className="text-xs text-white/50">
            {[identity.location, identity.email].filter(Boolean).join(' · ')}
          </div>
        )}
        {identity.summary && <div className="mt-1.5 text-sm text-white/70">{identity.summary}</div>}
      </div>

      {/* Counts */}
      <div className="mb-4 flex gap-4 text-xs text-white/60">
        <span>{profileData.experienceCount ?? experience.length} roles</span>
        <span>{profileData.projectCount ?? projects.length} projects</span>
        <span>{profileData.educationCount ?? 0} education</span>
        {typeof profileData.nodeCount === 'number' && <span>{profileData.nodeCount} indexed</span>}
      </div>

      {/* Skills */}
      {skills.length > 0 && (
        <div className={section}>
          <div className={heading}>Skills</div>
          <div>{skills.map((s, i) => <span key={`${s}-${i}`} className={chip}>{s}</span>)}</div>
        </div>
      )}

      {/* Experience */}
      {experience.length > 0 && (
        <div className={section}>
          <div className={heading}>Experience</div>
          {experience.map((e, i) => (
            <div key={i} className="mb-2">
              <div className="text-sm font-medium">
                {[e.role, e.company && `· ${e.company}`].filter(Boolean).join(' ')}
              </div>
              {(e.start_date || e.end_date) && (
                <div className="text-xs text-white/40">
                  {[e.start_date, e.end_date ?? 'Present'].filter(Boolean).join(' – ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Projects */}
      {projects.length > 0 && (
        <div className={section}>
          <div className={heading}>Projects</div>
          {projects.map((p, i) => (
            <div key={i} className="mb-2">
              <div className="text-sm font-medium">{p.name}</div>
              {p.description && <div className="text-xs text-white/60">{p.description}</div>}
              {Array.isArray(p.technologies) && p.technologies.length > 0 && (
                <div className="mt-1">{p.technologies.map((t, j) => <span key={j} className={chip}>{t}</span>)}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Active JD */}
      {hasActiveJD && activeJD && (
        <div className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3">
          <div className={heading}>Target job</div>
          <div className="text-sm font-medium">
            {[activeJD.title, activeJD.company && `· ${activeJD.company}`].filter(Boolean).join(' ')}
          </div>
          {Array.isArray(activeJD.technologies) && activeJD.technologies.length > 0 && (
            <div className="mt-1">{activeJD.technologies.map((t, j) => <span key={j} className={chip}>{t}</span>)}</div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProfileVisualizer;
