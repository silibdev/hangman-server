import { BadRequestException, Body, Controller, Delete, Get, Logger, Param, Post, Put } from '@nestjs/common';
import { GameService } from './game.service';
import {
  GuessDto,
  GuessInfo,
  PlayerInfo,
  RoomDto,
  RoomEntity,
  roomEntityToDto,
  UserDto,
  WordGuessDto,
  WordToGuessDto
} from './game.models';
import { GameGateway } from './game.gateway';
import { IsPlayerInTurnGuard, IsPlayerMasterGuard, PlayerIdHeader } from './player-in-turn.guard';

@Controller('game')
export class GameController {
  private readonly logger = new Logger(GameController.name);

  constructor(
    private gameService: GameService,
    private gameGateway: GameGateway
  ) {
  }

  @Post('rooms')
  createRoom(@Body() {name: userName}: UserDto, @PlayerIdHeader() userId: string): RoomDto {
    this.logger.log('create-room ' + userId);
    const room = this.gameService.createRoom(userId, userName);
    return roomEntityToDto(room);
  }

  @Get('rooms/:roomId')
  getRoom(@Param('roomId') roomId: string): RoomDto {
    this.logger.log('controller-room ' + roomId);
    const room = this.gameService.getRoomById(roomId);
    return roomEntityToDto(room);
  }

  @Put('rooms/:roomId/restart-game')
  @IsPlayerMasterGuard()
  restartGame(@Param('roomId') roomId: string) {
    this.logger.log('restart-game ' + roomId)
    const room = this.gameService.getRoomById(roomId);
    room.restartGame();
    const roomDto = roomEntityToDto(room);
    this.gameGateway.restartGame(roomDto);
    return roomDto;
  }

  @Post('rooms/:roomId/players')
  joinRoom(
    @Param('roomId') roomId: string,
    @Body() {name}: UserDto,
    @PlayerIdHeader() userId: string
    ): PlayerInfo {
    this.logger.log('controller-join ' + roomId + ', ' + userId + ', ' + name);

    const returningPlayer = this.gameService.getReturningPlayer(userId);
    let points = 0;
    if (returningPlayer?.roomId === roomId) {
      points = returningPlayer.player.points;
    }

    const player = this.gameService.addPlayer(roomId, userId, name, points);
    this.gameGateway.join(roomId, player);

    const room = this.gameService.getRoomById(roomId);
    if (returningPlayer?.wasMaster && room.round === returningPlayer.round) {
      this.gameService.updateMaster(room.id, player.id);
      this.gameGateway.updateMaster(room.id, player.id);

      if (!room.currentWord.length) {
        room.currentTurn = userId;
        this.gameGateway.newTurn(roomId, userId);
      }
    }

    return player;
  }

  @Delete('rooms/:roomId/players/:playerId')
  removePlayer(@Param() {roomId, playerId}: { roomId: string, playerId: string }): PlayerInfo {
    this.logger.log('controller-remove-player ' + roomId + ', ' + playerId);
    const playerLeaving = this.gameService.removePlayer(roomId, playerId, {save: false});
    this.gameGateway.leaveRoom(roomId, playerLeaving);

    if (this.gameService.isPlayerInTurn(roomId, playerId)) {
      this.gameGateway.newTurn(roomId, this.gameService.updateNextTurn(roomId));
    }
    return playerLeaving.player;
  }

  @Post('rooms/:roomId/word')
  @IsPlayerInTurnGuard()
  setWord(@Param('roomId') roomId: string, @Body() {word}: WordToGuessDto): string {
    this.logger.log('controller-word ' + roomId + ', ' + word);
    const room = this.gameService.getRoomById(roomId);
    room.setWord(word);
    this.gameGateway.setWord(roomId, room.currentWord);
    this.gameGateway.newTurn(roomId, room.updateNextTurn());
    return word;
  }

  @Post('rooms/:roomId/guesses')
  @IsPlayerInTurnGuard()
  newGuess(@Param('roomId') roomId: string, @Body() {letter: char}: GuessDto): GuessInfo {
    this.logger.log('controller-new-guess ' + roomId + ', ' + char);
    const room = this.gameService.getRoomById(roomId);

    if (room.checkGuessIsPresent(char)) {
      throw new BadRequestException(`Letter "${char}" already guessed`)
    }

    const guessInfo = room.addGuess(char);
    this.gameGateway.newGuess(roomId, guessInfo);
    if (!this.checkGameFinished(room)) {
      this.gameGateway.newTurn(room.id, room.updateNextTurn());
    }

    return guessInfo;
  }

  private checkGameFinished(room: RoomEntity): boolean {
    const finishState = this.gameService.checkGameFinished(room.id);
    if (finishState) {
      room.currentWord
        .map(l => room.addGuess(l.letter))
        .forEach(
          (guessInfo: GuessInfo) => {
            this.gameGateway.newGuess(room.id, guessInfo)
          }
        );
      this.gameGateway.finishGame(room.id, finishState);
      this.gameGateway.updatePlayer(room.id, finishState.player);
    }
    return !!finishState;
  }

  @Post('rooms/:roomId/word-guesses')
  newWordGuess(
    @Param('roomId') roomId: string,
    @Body() wordGuess: WordGuessDto,
    @PlayerIdHeader() userId: string
  ): WordGuessDto {
    this.logger.log('controller-word-guess ' + roomId + ', ' + wordGuess.word);
    const room = this.gameService.getRoomById(roomId);
    room.checkWordGuess(userId, wordGuess.word)
    if (!this.checkGameFinished(room)) {
      this.gameGateway.newWordGuess(roomId, wordGuess.word);
    }
    return wordGuess;
  }
}
