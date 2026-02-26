/**
 * Trusted ClawMon — Benefit Provisioner (Phase 6)
 *
 * Off-chain orchestration for provisioning VPS, compute, and other
 * resources when a skill's benefit tier changes. Listens for
 * BenefitActivated/Upgraded events and provisions accordingly.
 *
 * In production, this would call actual cloud provisioning APIs
 * (Docker, K8s, VPS providers). For now, uses stub implementations
 * that generate resource IDs and track state.
 */

import { ethers } from 'ethers';
import type { BenefitTierName, ProvisioningRequest, ProvisioningResult } from './types.js';

// ---------------------------------------------------------------------------
// In-Memory Provisioning State
// ---------------------------------------------------------------------------

const provisionedResources = new Map<number, ProvisioningResult>();

// ---------------------------------------------------------------------------
// Stub Provisioners
// ---------------------------------------------------------------------------

/**
 * Provision VPS sandbox for Silver+ tier skills.
 * In production: calls Docker / VPS API to create isolated container.
 */
async function provisionVps(skillId: number, publisher: string): Promise<string> {
  // Generate deterministic VPS ID from skill + timestamp
  const seed = `vps-${skillId}-${publisher}-${Date.now()}`;
  const vpsId = ethers.id(seed);
  console.log(`[Provisioner] VPS created for skill ${skillId}: ${vpsId.slice(0, 18)}...`);
  return vpsId;
}

/**
 * Provision dedicated compute for Gold tier skills.
 * In production: calls K8s / compute API to allocate resources.
 */
async function provisionCompute(skillId: number, publisher: string): Promise<string> {
  const seed = `compute-${skillId}-${publisher}-${Date.now()}`;
  const computeId = ethers.id(seed);
  console.log(`[Provisioner] Compute allocated for skill ${skillId}: ${computeId.slice(0, 18)}...`);
  return computeId;
}

/**
 * Deprovision resources when tier drops.
 * In production: calls cloud APIs to destroy containers/compute.
 */
async function deprovisionResources(skillId: number): Promise<void> {
  console.log(`[Provisioner] Resources deprovisioned for skill ${skillId}`);
  provisionedResources.delete(skillId);
}

// ---------------------------------------------------------------------------
// Main Provisioning Logic
// ---------------------------------------------------------------------------

/**
 * Provision resources for a skill based on its benefit tier.
 * Called when tier changes (activation, upgrade, or downgrade).
 */
export async function provisionForTier(
  request: ProvisioningRequest,
): Promise<ProvisioningResult> {
  const { skillId, tier, publisher } = request;

  if (tier === 'none') {
    await deprovisionResources(skillId);
    const result: ProvisioningResult = {
      skillId,
      tier,
      provisionedAt: Math.floor(Date.now() / 1000),
    };
    return result;
  }

  let vpsId: string | undefined;
  let computeId: string | undefined;

  // Silver+ gets VPS
  if (tier === 'silver' || tier === 'gold') {
    vpsId = await provisionVps(skillId, publisher);
  }

  // Gold gets dedicated compute
  if (tier === 'gold') {
    computeId = await provisionCompute(skillId, publisher);
  }

  const result: ProvisioningResult = {
    skillId,
    tier,
    vpsId,
    computeId,
    provisionedAt: Math.floor(Date.now() / 1000),
  };

  provisionedResources.set(skillId, result);
  return result;
}

/**
 * Handle a tier change for a skill. Provisions or deprovisions as needed.
 */
export async function handleTierChange(
  skillId: number,
  oldTier: BenefitTierName,
  newTier: BenefitTierName,
  publisher: string,
): Promise<ProvisioningResult> {
  console.log(`[Provisioner] Tier change for skill ${skillId}: ${oldTier} → ${newTier}`);

  return provisionForTier({
    skillId,
    tier: newTier,
    publisher,
  });
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Get provisioned resources for a skill.
 */
export function getProvisionedResources(skillId: number): ProvisioningResult | null {
  return provisionedResources.get(skillId) ?? null;
}

/**
 * Get all provisioned resources.
 */
export function getAllProvisionedResources(): ProvisioningResult[] {
  return Array.from(provisionedResources.values());
}

/**
 * Reset provisioning state (for testing).
 */
export function resetProvisioning(): void {
  provisionedResources.clear();
}
