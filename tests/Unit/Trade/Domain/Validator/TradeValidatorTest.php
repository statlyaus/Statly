<?php

declare(strict_types=1);

namespace Statly\Tests\Unit\Trade\Domain\Validator;

use PHPUnit\Framework\TestCase;
use Statly\Trade\Domain\Dto\TradeDetails;
use Statly\Trade\Domain\Enum\TradeStatus;
use Statly\Trade\Domain\Exception\InvalidTradeStateException;
use Statly\Trade\Domain\Exception\UnauthorizedTradeActionException;
use Statly\Trade\Domain\TradeValidator;

final class TradeValidatorTest extends TestCase
{
    public function testAssertTransitionAllowsProposedToExecuted(): void
    {
        $validator = new TradeValidator();

        $validator->assertTransition(TradeStatus::PROPOSED, TradeStatus::EXECUTED);

        $this->assertTrue(true);
    }

    public function testAssertTransitionRejectsNonProposedTransitions(): void
    {
        $validator = new TradeValidator();

        $this->expectException(InvalidTradeStateException::class);
        $validator->assertTransition(TradeStatus::DECLINED, TradeStatus::CANCELLED);
    }

    public function testValidateAcceptRequiresRecipient(): void
    {
        $validator = new TradeValidator();
        $trade = $this->makeTrade(TradeStatus::PROPOSED, 'proposer', 'recipient');

        $this->expectException(UnauthorizedTradeActionException::class);
        $validator->validateAccept($trade, 'other-user');
    }

    public function testValidateDeclineRequiresRecipient(): void
    {
        $validator = new TradeValidator();
        $trade = $this->makeTrade(TradeStatus::PROPOSED, 'proposer', 'recipient');

        $this->expectException(UnauthorizedTradeActionException::class);
        $validator->validateDecline($trade, 'proposer');
    }

    public function testValidateCancelRequiresProposer(): void
    {
        $validator = new TradeValidator();
        $trade = $this->makeTrade(TradeStatus::PROPOSED, 'proposer', 'recipient');

        $this->expectException(UnauthorizedTradeActionException::class);
        $validator->validateCancel($trade, 'recipient');
    }

    public function testValidateAcceptRejectsNonProposedStatus(): void
    {
        $validator = new TradeValidator();
        $trade = $this->makeTrade(TradeStatus::EXECUTED, 'proposer', 'recipient');

        $this->expectException(InvalidTradeStateException::class);
        $validator->validateAccept($trade, 'recipient');
    }

    private function makeTrade(TradeStatus $status, string $proposerId, string $recipientId): TradeDetails
    {
        return new TradeDetails(
            'trade-1',
            'league-1',
            'round-1',
            $proposerId,
            $recipientId,
            $status,
            [],
            []
        );
    }
}
