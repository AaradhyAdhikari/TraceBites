// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title CropStoryRegistry
 * @notice Anchors the fingerprint of a produce supply chain. Never its contents.
 *
 * What is deliberately NOT here:
 *   · names, phone numbers, plot coordinates, photos, invoices — anything that
 *     identifies a person. The DPDP Act 2023 grants a right to erasure that an
 *     immutable ledger cannot honour, so the off-chain database holds personal
 *     data and this contract holds salted hashes of references to it. Deleting a
 *     person's salt renders the on-chain value permanently unlinkable, which
 *     satisfies erasure while leaving the chain intact.
 *   · quantities and prices in the clear. They are inside payloadHash, so they
 *     can be proven unchanged by anyone shown the original values, without being
 *     broadcast to everyone forever.
 *
 * Scale: writing every event individually does not pay at national volume, so
 * only high-consequence kinds are written one by one. Everything else is
 * hash-chained off-chain and committed here as a Merkle root — one transaction
 * covering thousands of events. See anchorRoot.
 */
contract CropStoryRegistry is AccessControl, Pausable {
    bytes32 public constant FARMER_ROLE = keccak256("FARMER_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 public constant RETAILER_ROLE = keccak256("RETAILER_ROLE");
    bytes32 public constant INSPECTOR_ROLE = keccak256("INSPECTOR_ROLE");
    /// @dev The relayer that pays gas on every org's behalf. Farmers hold no wallet.
    bytes32 public constant ANCHOR_ROLE = keccak256("ANCHOR_ROLE");

    enum EventKind {
        HARVESTED,
        CUSTODY_TRANSFERRED,
        BATCH_SPLIT,
        SOLD,
        RECALLED,
        INSPECTED
    }

    struct Batch {
        bytes32 originOrgRef;
        bytes32 custodianOrgRef;
        uint64 registeredAt;
        uint32 eventCount;
        bool exists;
        bool recalled;
    }

    mapping(bytes32 => Batch) public batches;
    /// @dev batchId => running head of the off-chain hash chain, as last anchored.
    mapping(bytes32 => bytes32) public chainHead;

    uint64 public rootCount;

    event BatchRegistered(bytes32 indexed batchId, bytes32 indexed orgRef, bytes32 payloadHash, uint64 occurredAt);
    event EventAppended(
        bytes32 indexed batchId, EventKind indexed kind, bytes32 payloadHash, bytes32 newHead, uint64 occurredAt
    );
    event BatchSplit(bytes32 indexed parent, bytes32[] children, uint64 occurredAt);
    event CustodyTransferred(bytes32 indexed batchId, bytes32 indexed fromOrgRef, bytes32 indexed toOrgRef);
    event RootAnchored(bytes32 indexed merkleRoot, uint64 fromSeq, uint64 toSeq, uint32 eventCount);
    event RecallFlagged(bytes32 indexed batchId, bytes32 reasonHash);

    error BatchExists(bytes32 batchId);
    error UnknownBatch(bytes32 batchId);
    error AlreadyRecalled(bytes32 batchId);
    error EmptyChildren();

    constructor(address admin, address relayer) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ANCHOR_ROLE, relayer);
    }

    /// @notice First link of a batch's chain. Called once, at harvest.
    function registerBatch(bytes32 batchId, bytes32 payloadHash, bytes32 orgRef, uint64 occurredAt)
        external
        whenNotPaused
        onlyRole(ANCHOR_ROLE)
    {
        if (batches[batchId].exists) revert BatchExists(batchId);

        batches[batchId] = Batch({
            originOrgRef: orgRef,
            custodianOrgRef: orgRef,
            registeredAt: occurredAt,
            eventCount: 1,
            exists: true,
            recalled: false
        });
        chainHead[batchId] = payloadHash;

        emit BatchRegistered(batchId, orgRef, payloadHash, occurredAt);
    }

    /// @notice Appends one high-consequence event and advances the batch's head.
    function appendEvent(bytes32 batchId, EventKind kind, bytes32 payloadHash, uint64 occurredAt)
        external
        whenNotPaused
        onlyRole(ANCHOR_ROLE)
    {
        Batch storage b = batches[batchId];
        if (!b.exists) revert UnknownBatch(batchId);

        bytes32 newHead = keccak256(abi.encodePacked(chainHead[batchId], payloadHash));
        chainHead[batchId] = newHead;
        unchecked {
            b.eventCount += 1;
        }

        emit EventAppended(batchId, kind, payloadHash, newHead, occurredAt);
    }

    /**
     * @notice Splits a batch into child lots, each inheriting provenance.
     * @dev The operation most traceability systems omit. A 500-quintal batch does
     *      not reach one consumer; without lineage on chain, a recall cannot find
     *      the eleven retail lots it became.
     */
    function splitBatch(bytes32 parent, bytes32[] calldata children, bytes32[] calldata payloadHashes, uint64 occurredAt)
        external
        whenNotPaused
        onlyRole(ANCHOR_ROLE)
    {
        Batch storage p = batches[parent];
        if (!p.exists) revert UnknownBatch(parent);
        if (children.length == 0 || children.length != payloadHashes.length) revert EmptyChildren();

        for (uint256 i = 0; i < children.length; ++i) {
            if (batches[children[i]].exists) revert BatchExists(children[i]);
            batches[children[i]] = Batch({
                originOrgRef: p.originOrgRef,
                custodianOrgRef: p.custodianOrgRef,
                registeredAt: occurredAt,
                eventCount: 1,
                exists: true,
                // A child of a recalled batch is recalled. Recall must not be
                // escapable by splitting.
                recalled: p.recalled
            });
            chainHead[children[i]] = keccak256(abi.encodePacked(chainHead[parent], payloadHashes[i]));
        }

        emit BatchSplit(parent, children, occurredAt);
    }

    function transferCustody(bytes32 batchId, bytes32 toOrgRef, bytes32 payloadHash, uint64 occurredAt)
        external
        whenNotPaused
        onlyRole(ANCHOR_ROLE)
    {
        Batch storage b = batches[batchId];
        if (!b.exists) revert UnknownBatch(batchId);
        if (b.recalled) revert AlreadyRecalled(batchId);

        bytes32 from = b.custodianOrgRef;
        b.custodianOrgRef = toOrgRef;
        chainHead[batchId] = keccak256(abi.encodePacked(chainHead[batchId], payloadHash));
        unchecked {
            b.eventCount += 1;
        }

        emit CustodyTransferred(batchId, from, toOrgRef);
        emit EventAppended(batchId, EventKind.CUSTODY_TRANSFERRED, payloadHash, chainHead[batchId], occurredAt);
    }

    /**
     * @notice Commits a Merkle root covering many off-chain events at once.
     * @dev This is what makes the design affordable. Routine events — photos,
     *      gradings, cold-chain pings — are hash-chained in Postgres and swept
     *      here every few minutes in a single transaction.
     */
    function anchorRoot(bytes32 merkleRoot, uint64 fromSeq, uint64 toSeq, uint32 eventCount)
        external
        whenNotPaused
        onlyRole(ANCHOR_ROLE)
    {
        unchecked {
            rootCount += 1;
        }
        emit RootAnchored(merkleRoot, fromSeq, toSeq, eventCount);
    }

    function flagRecall(bytes32 batchId, bytes32 reasonHash) external whenNotPaused onlyRole(INSPECTOR_ROLE) {
        Batch storage b = batches[batchId];
        if (!b.exists) revert UnknownBatch(batchId);
        b.recalled = true;
        emit RecallFlagged(batchId, reasonHash);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
