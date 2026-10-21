import {z} from 'zod';
const key=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const harnessConfig=z.object({
 entry:z.string().default(''),
 maxSteps:z.number().int().min(1).max(500).default(30),
 maxVisits:z.number().int().min(1).max(50).default(3),
 // Empty scopes reserve the whole workspace. Explicit paths are cooperative locks.
 resources:z.array(z.string().min(1).max(500)).max(30).default([]),
}).default({entry:'',maxSteps:30,maxVisits:3,resources:[]});
export const harnessStep=z.object({
 kind:z.enum(['agent','run','manual']).default('manual'),
 prompt:z.string().max(20000).default(''),
 phase:z.string().max(80).default(''),
 acceptance:z.string().max(6000).default(''),
 inputNotes:z.string().max(6000).default(''),
 outputNotes:z.string().max(6000).default(''),
 skills:z.array(z.string().max(500)).max(20).default([]),
 provider:z.enum(['inherit','claude','codex']).default('inherit'),
 recipeId:z.string().max(100).default(''),
 parameters:z.record(z.string(),z.union([z.string(),z.number(),z.boolean()])).default({}),
 timeoutSeconds:z.number().int().min(10).max(7200).default(1800),
 maxVisits:z.number().int().min(1).max(50).optional(),
 review:z.boolean().default(false),
});
export const startHarness=z.object({
 diagramId:key,targetBlockId:z.string().default(''),targetDiagramId:z.string().default(''),
 mode:z.enum(['automatic','manual']).default('automatic'),provider:z.enum(['claude','codex']).default('claude'),
 instruction:z.string().max(10000).default(''),
 revision:z.number().int().optional(),requestId:z.string().uuid().optional(),
});
