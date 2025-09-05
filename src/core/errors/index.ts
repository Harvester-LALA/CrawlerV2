export class Error429 extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Error429';
  }
}

export class Error3XX extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Error3XX';
  }
}

export class EndOfPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EndOfPageError';
  }
}

export class InvalidUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUrlError';
  }
}
