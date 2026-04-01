import Organization from "@models/organization.model";
import { ORGANIZATION_NAME, ORGANIZATION_UUID, setOrganizationId } from "../config";
import { logger } from "../lib/logger";

const CTX = "phase1/organization";

export async function importOrganization(): Promise<void> {
    logger.info(CTX, "Checking for existing organization...");

    // Check if org already exists by organization_id (UUID)
    let org = await Organization.findOne({
        where: { organization_id: ORGANIZATION_UUID },
    });

    if (org) {
        logger.info(CTX, `Organization already exists: id=${org.id}, name="${org.name}"`);
        setOrganizationId(org.id);

        if (!org.npi) {
            await org.update({ npi: "1497250955" });
            logger.info(CTX, `Updated organization NPI: 1497250955`);
        }

        return;
    }

    // Create new organization
    org = await Organization.create({
        organization_id: ORGANIZATION_UUID,
        name: ORGANIZATION_NAME,
        npi: "1497250955",
        is_ema_integration: false,
        is_ema_lite_enabled: true,
        is_internal: false,
        has_ePrescription: false,
        has_lab_order: true,
    });

    setOrganizationId(org.id);
    logger.info(CTX, `Created organization: id=${org.id}, name="${org.name}"`);
}
